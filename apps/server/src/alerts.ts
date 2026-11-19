/**
 * Vacancy alerts, and the `alerts` endpoints of the API.
 *
 * An alert is one account watching one class, and a class is a term and a
 * CRN. The `classes` table remembers each watched class's title and whether
 * it had a free seat when last looked at. The check every minute that emails
 * students when that changes is not written yet; it will keep that state up
 * to date, and nothing here may overwrite it (see `subscribe`).
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
 * Add the student's alert, if somebody already watches the class. The check
 * and the insert are one statement, so the last watcher cannot leave in
 * between and leave the alert on a class whose state nobody keeps up to date.
 * False when nothing was added: nobody watches the class, or the student
 * already does.
 */
const joinWatchedClass = Effect.fn("subscribe.joinWatchedClass")(
  function*(accountId: number, term: Term, crn: Crn, key: string) {
    const sql = yield* SqlClient.SqlClient
    const now = yield* Clock.currentTimeMillis
    const added = yield* sql`
      INSERT INTO alerts (account_id, term, crn, unsubscribe_key, created_at)
      SELECT ${accountId}, ${term}, ${crn}, ${key}, ${now}
      WHERE EXISTS (SELECT 1 FROM alerts WHERE term = ${term} AND crn = ${crn})
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

/**
 * Ask the university for the class, and record its title and state, unless
 * somebody has started watching it meanwhile. (A row can be left from people
 * who watched it before; it is out of date, so it is replaced.)
 */
const recordClass = Effect.fn("subscribe.recordClass")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const university = yield* University
  const title = yield* university.classTitle(term, crn)
  const seats = yield* university.seats(term, crn)
  // If another student started watching while the university was asked,
  // their recorded state stands, for the reason given at `subscribe`. The
  // `WHERE` makes the write happen only if nobody watches the class yet,
  // checked in the same statement so nobody can start watching in between.
  yield* sql`
    INSERT INTO classes (term, crn, title, vacant) VALUES (${term}, ${crn}, ${title}, ${isVacant(seats) ? 1 : 0})
    ON CONFLICT (term, crn) DO UPDATE SET title = excluded.title, vacant = excluded.vacant
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
 * The class's title as recorded, which is what the student's list shows. It
 * can differ from what this request learnt from the university, if another
 * student recorded the class first.
 */
const storedTitle = Effect.fn("subscribe.storedTitle")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ title: string }>`SELECT title FROM classes WHERE term = ${term} AND crn = ${crn}`
  return rows[0]!.title
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
 * Start alerts for a class, and email the student a confirmation with an
 * unsubscribe link.
 *
 * A class somebody already watches is joined as it is, and the university is
 * not asked. Its recorded state belongs to the check that runs every minute:
 * writing today's state here would hide a change from the students already
 * watching, who would then never hear about it. Only a class nobody watches
 * is looked up and recorded afresh.
 */
export const subscribe = Effect.fn("subscribe")(function*(signedIn: SignedIn["Service"], term: Term, crn: Crn) {
  const key = yield* randomKey(16)
  const joined = yield* joinWatchedClass(signedIn.accountId, term, crn, key)
  if (!joined) {
    if (yield* hasAlert(signedIn.accountId, term, crn)) {
      return yield* alreadySubscribed
    }
    // Nobody watches the class. Between the statements below others can
    // start or stop watching it too, and that is harmless: the class's state
    // is either written while nobody watches it (so nobody's state is
    // replaced), or left as the check every minute keeps it, which is what
    // anyone joining a watched class gets.
    yield* recordClass(term, crn)
    if (!(yield* addAlert(signedIn.accountId, term, crn, key))) {
      // The same student, from another browser, got there first.
      return yield* alreadySubscribed
    }
  }
  const alert = { term, crn, title: yield* storedTitle(term, crn) } satisfies Alert
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
