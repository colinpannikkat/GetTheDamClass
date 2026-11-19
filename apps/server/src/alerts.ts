/**
 * Vacancy alerts, and the `alerts` endpoints of the API.
 *
 * An alert is one account watching one class, and a class is a term and a
 * CRN. The `classes` table remembers each watched class's title, whether it
 * had a free seat when last looked at, and its add deadline. The check every
 * minute (poll.ts) keeps that state up to date and emails the students when
 * it changes; nothing here may overwrite it (see `subscribe`). Which classes
 * take alerts at all is the term rule (termRule.ts).
 */
import { Api, SignedIn } from "@getthedamclass/shared/Api"
import { type Alert, AlreadySubscribed, type Crn, type EmailAddress, NotSubscribed, type Term } from "@getthedamclass/shared/domain"
import { Clock, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { subscriptionConfirmedEmail } from "./emails"
import { Mailer } from "./Mailer"
import { randomKey } from "./secrets"
import { addDeadline, addDeadlinePassed, requireOpenTerm, todayInOregon } from "./termRule"
import { isVacant, University } from "./University"
import { unsubscribeUrl } from "./unsubscribe"

/**
 * Every alert of an account, in the order they were made. (`rowid`, SQLite's
 * own row number, settles alerts made in the same millisecond.) Only the
 * database is asked.
 */
export const listAlerts = Effect.fn("listAlerts")(function*(accountId: number) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<Alert>`
    SELECT alerts.term AS term, alerts.crn AS crn, classes.title AS title
    FROM alerts JOIN classes ON classes.term = alerts.term AND classes.crn = alerts.crn
    WHERE alerts.account_id = ${accountId}
    ORDER BY alerts.created_at, alerts.rowid
  `
}, dieOnSqlError)

/**
 * Add the student's alert, if somebody already watches the class and its add
 * deadline (an ISO date, like `today`) has not passed. The checks and the
 * insert are one statement, so the last watcher cannot leave in between and
 * leave the alert on a class whose state nobody keeps up to date. False when
 * nothing was added: nobody watches the class, its deadline has passed, or
 * the student already watches it.
 */
const joinWatchedClass = Effect.fn("subscribe.joinWatchedClass")(
  function*(accountId: number, term: Term, crn: Crn, key: string, today: string) {
    const sql = yield* SqlClient.SqlClient
    const now = yield* Clock.currentTimeMillis
    // A class without dates has a NULL deadline, which `<` never matches.
    const added = yield* sql`
      INSERT INTO alerts (account_id, term, crn, unsubscribe_key, created_at)
      SELECT ${accountId}, ${term}, ${crn}, ${key}, ${now}
      WHERE EXISTS (SELECT 1 FROM alerts WHERE term = ${term} AND crn = ${crn})
        AND NOT EXISTS (SELECT 1 FROM classes WHERE term = ${term} AND crn = ${crn} AND add_deadline < ${today})
      ON CONFLICT (account_id, term, crn) DO NOTHING
      RETURNING crn
    `
    return added.length > 0
  },
  dieOnSqlError
)

/** Whether the account already gets alerts for this class. */
const hasAlert = Effect.fn("subscribe.hasAlert")(function*(accountId: number, term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`
    SELECT 1 FROM alerts WHERE account_id = ${accountId} AND term = ${term} AND crn = ${crn}
  `
  return rows.length > 0
}, dieOnSqlError)

/** Whether anybody watches the class. */
const isWatched = Effect.fn("subscribe.isWatched")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`SELECT 1 FROM alerts WHERE term = ${term} AND crn = ${crn} LIMIT 1`
  return rows.length > 0
}, dieOnSqlError)

/**
 * Ask the university for the class, and record its title, state and add
 * deadline, unless somebody has started watching it meanwhile. (A row can be
 * left from people who watched it before; it is out of date, so it is
 * replaced.)
 */
const recordClass = Effect.fn("subscribe.recordClass")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const university = yield* University
  const title = yield* university.classTitle(term, crn)
  const seats = yield* university.seats(term, crn)
  const deadline = addDeadline(yield* university.meetingDates(term, crn)) ?? null
  // If another student started watching while the university was asked,
  // their recorded state stands, for the reason given at `subscribe`. The
  // `WHERE` makes the write happen only if nobody watches the class yet,
  // checked in the same statement so nobody can start watching in between.
  yield* sql`
    INSERT INTO classes (term, crn, title, vacant, add_deadline)
    VALUES (${term}, ${crn}, ${title}, ${isVacant(seats) ? 1 : 0}, ${deadline})
    ON CONFLICT (term, crn) DO UPDATE
      SET title = excluded.title, vacant = excluded.vacant, add_deadline = excluded.add_deadline
      WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
  `
}, dieOnSqlError)

/** Add the student's alert for a recorded class. False if they already had it. */
const addAlert = Effect.fn("subscribe.addAlert")(function*(accountId: number, term: Term, crn: Crn, key: string) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const added = yield* sql`
    INSERT INTO alerts (account_id, term, crn, unsubscribe_key, created_at)
    VALUES (${accountId}, ${term}, ${crn}, ${key}, ${now})
    ON CONFLICT (account_id, term, crn) DO NOTHING
    RETURNING crn
  `
  return added.length > 0
}, dieOnSqlError)

/**
 * The class as recorded: its title, which is what the student's list shows,
 * and its add deadline. They can differ from what this request learnt from
 * the university, if another student recorded the class first.
 */
const recordedClass = Effect.fn("subscribe.recordedClass")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ title: string; addDeadline: string | null }>`
    SELECT title, add_deadline AS addDeadline FROM classes WHERE term = ${term} AND crn = ${crn}
  `
  return rows[0]!
}, dieOnSqlError)

/**
 * Email the confirmation. The alert stands even if this email cannot be sent:
 * the student asked for alerts, not for the email, and can see the alert in
 * the extension.
 */
const sendConfirmation = Effect.fn("subscribe.sendConfirmation")(function*(to: EmailAddress, alert: Alert, key: string) {
  const mailer = yield* Mailer
  const email = subscriptionConfirmedEmail(to, { ...alert, unsubscribeUrl: yield* unsubscribeUrl(key) })
  yield* mailer.send(email).pipe(
    Effect.catchTag("SendFailed", (error) => Effect.logWarning("Could not send a subscription confirmation", error.reason))
  )
})

const alreadySubscribed = new AlreadySubscribed({ message: "You already get alerts for this class." })

/**
 * The rest of `subscribe`, for when `joinWatchedClass` added nothing: the
 * student already watches the class, or nobody does, or its add deadline has
 * passed. A class nobody watches is recorded first. Returns the class as
 * recorded.
 */
const recordClassAndAddAlert = Effect.fn("subscribe.recordClassAndAddAlert")(
  function*(accountId: number, term: Term, crn: Crn, key: string, today: string) {
    if (yield* hasAlert(accountId, term, crn)) {
      return yield* alreadySubscribed
    }
    // Between the statements below others can start or stop watching the
    // class too, and that is harmless: the class's state is either written
    // while nobody watches it (so nobody's state is replaced), or left as the
    // check every minute keeps it, which is what anyone joining a watched
    // class gets.
    if (!(yield* isWatched(term, crn))) {
      yield* recordClass(term, crn)
    }
    const recorded = yield* recordedClass(term, crn)
    if (recorded.addDeadline !== null && today > recorded.addDeadline) {
      return yield* addDeadlinePassed({ title: recorded.title, crn }, recorded.addDeadline)
    }
    if (!(yield* addAlert(accountId, term, crn, key))) {
      // The same student, from another browser, got there first.
      return yield* alreadySubscribed
    }
    return recorded
  }
)

/**
 * Start alerts for a class, and email the student a confirmation with an
 * unsubscribe link.
 *
 * First, always, the university's term list is read, to check that the term
 * is open (see termRule.ts). If it cannot be read, nothing is created.
 *
 * A class somebody already watches is then joined as it is, and the class
 * itself is not looked up. Its recorded state belongs to the check that runs
 * every minute: writing today's state here would hide a change from the
 * students already watching, who would then never hear about it. Only a class
 * nobody watches is looked up and recorded afresh.
 *
 * The add deadline is checked against the recorded class, so it is worked
 * out once per class, when the class is first recorded.
 */
export const subscribe = Effect.fn("subscribe")(function*(signedIn: SignedIn["Service"], term: Term, crn: Crn) {
  yield* requireOpenTerm(term)
  const today = yield* todayInOregon
  const key = yield* randomKey(16)
  const recorded = (yield* joinWatchedClass(signedIn.accountId, term, crn, key, today))
    ? yield* recordedClass(term, crn)
    : yield* recordClassAndAddAlert(signedIn.accountId, term, crn, key, today)
  const alert = { term, crn, title: recorded.title } satisfies Alert
  yield* sendConfirmation(signedIn.email, alert, key)
  return alert
})

/** Stop alerts for a class. The university is not asked, so alerts of any term can be stopped. */
export const unsubscribe = Effect.fn("unsubscribe")(function*(accountId: number, term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const deleted = yield* sql`
    DELETE FROM alerts WHERE account_id = ${accountId} AND term = ${term} AND crn = ${crn}
    RETURNING crn
  `
  if (deleted.length === 0) {
    return yield* new NotSubscribed({ message: "You don't get alerts for this class." })
  }
}, dieOnSqlError)

export const AlertsHandlers = HttpApiBuilder.group(Api, "alerts", (handlers) =>
  handlers
    .handle("list", () => SignedIn.use((signedIn) => listAlerts(signedIn.accountId)))
    .handle("subscribe", ({ payload }) => SignedIn.use((signedIn) => subscribe(signedIn, payload.term, payload.crn)))
    .handle(
      "unsubscribe",
      ({ params }) => SignedIn.use((signedIn) => unsubscribe(signedIn.accountId, params.term, params.crn))
    ))
