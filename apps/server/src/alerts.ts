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

export const listAlerts = Effect.fn("listAlerts")(function*(accountId: number) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<Alert>`
    SELECT alerts.term AS term, alerts.crn AS crn, classes.title AS title
    FROM alerts JOIN classes ON classes.term = alerts.term AND classes.crn = alerts.crn
    WHERE alerts.account_id = ${accountId}
    ORDER BY alerts.created_at, alerts.rowid
  `
}, dieOnSqlError)

// The checks and the insert are one statement, so the last watcher cannot leave in between and
// leave the alert on a class nobody keeps up to date.
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

const hasAlert = Effect.fn("subscribe.hasAlert")(function*(accountId: number, term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`
    SELECT 1 FROM alerts WHERE account_id = ${accountId} AND term = ${term} AND crn = ${crn}
  `
  return rows.length > 0
}, dieOnSqlError)

const isWatched = Effect.fn("subscribe.isWatched")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`SELECT 1 FROM alerts WHERE term = ${term} AND crn = ${crn} LIMIT 1`
  return rows.length > 0
}, dieOnSqlError)

const recordClass = Effect.fn("subscribe.recordClass")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const university = yield* University
  const title = yield* university.classTitle(term, crn)
  const seats = yield* university.seats(term, crn)
  const deadline = addDeadline(yield* university.meetingDates(term, crn)) ?? null
  // The `WHERE` writes only if nobody watches the class yet, checked in the same statement so nobody can
  // start watching in between; otherwise the watchers' recorded state stands (see `subscribe`).
  yield* sql`
    INSERT INTO classes (term, crn, title, vacant, add_deadline)
    VALUES (${term}, ${crn}, ${title}, ${isVacant(seats) ? 1 : 0}, ${deadline})
    ON CONFLICT (term, crn) DO UPDATE
      SET title = excluded.title, vacant = excluded.vacant, add_deadline = excluded.add_deadline
      WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
  `
}, dieOnSqlError)

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

const recordedClass = Effect.fn("subscribe.recordedClass")(function*(term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ title: string; addDeadline: string | null }>`
    SELECT title, add_deadline AS addDeadline FROM classes WHERE term = ${term} AND crn = ${crn}
  `
  return rows[0]!
}, dieOnSqlError)

const sendConfirmation = Effect.fn("subscribe.sendConfirmation")(function*(to: EmailAddress, alert: Alert, key: string) {
  const mailer = yield* Mailer
  const email = subscriptionConfirmedEmail(to, { ...alert, unsubscribeUrl: yield* unsubscribeUrl(key) })
  yield* mailer.send(email).pipe(
    Effect.catchTag("SendFailed", (error) => Effect.logWarning("Could not send a subscription confirmation", error.reason))
  )
})

const alreadySubscribed = new AlreadySubscribed({ message: "You already get alerts for this class." })

const recordClassAndAddAlert = Effect.fn("subscribe.recordClassAndAddAlert")(
  function*(accountId: number, term: Term, crn: Crn, key: string, today: string) {
    if (yield* hasAlert(accountId, term, crn)) {
      return yield* alreadySubscribed
    }
    if (!(yield* isWatched(term, crn))) {
      yield* recordClass(term, crn)
    }
    const recorded = yield* recordedClass(term, crn)
    if (recorded.addDeadline !== null && today > recorded.addDeadline) {
      return yield* addDeadlinePassed({ title: recorded.title, crn }, recorded.addDeadline)
    }
    if (!(yield* addAlert(accountId, term, crn, key))) {
      return yield* alreadySubscribed
    }
    return recorded
  }
)

// A class somebody already watches is joined as recorded, not looked up: writing today's state here
// would hide a change from the students already watching it.
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
