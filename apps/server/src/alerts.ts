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
import { type Alert, AlreadySubscribed, type Crn, NotSubscribed, type Term } from "@getthedamclass/shared/domain"
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
 * Start alerts for a class, and email the student a confirmation with an
 * unsubscribe link.
 */
export const subscribe = Effect.fn("subscribe")(function*(signedIn: SignedIn["Service"], term: Term, crn: Crn) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis

  // A class somebody already watches is left exactly as it is, and the
  // university is not asked. Its state belongs to the check that runs every
  // minute: writing today's state here would hide a change from the students
  // already watching, who would then never hear about it.
  const watched = yield* sql<{ title: string }>`
    SELECT title FROM classes
    WHERE term = ${term} AND crn = ${crn}
      AND EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
  `
  let title = watched[0]?.title
  if (title === undefined) {
    // Nobody watches it: look it up, and remember it as it is now. (A row
    // can be left from people who watched it before; it is out of date, so
    // it is replaced.)
    const university = yield* University
    const found = yield* university.classTitle(term, crn)
    const seats = yield* university.seats(term, crn)
    // Another student may have started watching it while the university was
    // being asked. Then their recorded state stands, for the same reason as
    // above: the `WHERE` makes the write happen only if nobody watches it yet,
    // checked in the same statement so nobody can start watching in between.
    yield* sql`
      INSERT INTO classes (term, crn, title, vacant) VALUES (${term}, ${crn}, ${found}, ${isVacant(seats) ? 1 : 0})
      ON CONFLICT (term, crn) DO UPDATE SET title = excluded.title, vacant = excluded.vacant
        WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
    `
    // The title as stored: the other student's, if they got there first.
    const stored = yield* sql<{ title: string }>`SELECT title FROM classes WHERE term = ${term} AND crn = ${crn}`
    title = stored[0]!.title
  }

  const key = yield* randomKey(16)
  const created = yield* sql`
    INSERT INTO alerts (account_id, term, crn, unsubscribe_key, created_at)
    VALUES (${signedIn.accountId}, ${term}, ${crn}, ${key}, ${now})
    ON CONFLICT (account_id, term, crn) DO NOTHING
    RETURNING crn
  `
  if (created.length === 0) {
    return yield* new AlreadySubscribed({ message: "You already get alerts for this class." })
  }

  // The alert stands even if this email cannot be sent: the student asked for
  // alerts, not for the email, and can see the alert in the extension.
  const mailer = yield* Mailer
  const email = subscriptionConfirmedEmail(signedIn.email, { title, crn, unsubscribeUrl: yield* unsubscribeUrl(key) })
  yield* mailer.send(email).pipe(
    Effect.catchTag("SendFailed", (error) => Effect.logWarning("Could not send a subscription confirmation", error.reason))
  )
  return { term, crn, title } satisfies Alert
}, dieOnSqlError)

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
