/**
 * The check every minute: for each class somebody watches, ask the university
 * how full it is, and when it has gone from full to having a free seat, or
 * back, email each student who watches it. The `classes` table holds what the
 * last check saw (`vacant`); only a change from that sends email.
 *
 * One class failing to load does not stop the others. It keeps its recorded
 * state and its alerts, and the next run tries it again.
 *
 * How many classes one run can check. Cloudflare bounds a run started by a
 * cron trigger (https://developers.cloudflare.com/workers/platform/limits/,
 * read in November 2026):
 *
 * - Subrequests: 50 per run on the Workers Free plan, 10,000 on Paid. Each
 *   class is one request to the university. D1 queries count separately (50
 *   Free, 1,000 Paid): one for the list, and two for each class that changed.
 * - CPU time: 10 ms per run on Free, 30 seconds by default on Paid. Waiting
 *   for the university does not count; reading its pages does, a little.
 * - Wall time: 15 minutes per run. At most 6 connections can be open at once,
 *   which `CONCURRENCY` stays under.
 *
 * So on Free about 45 watched classes fit, if the CPU limit allows that many.
 * On Paid the clock is what counts. A run checking one class took about 0.17
 * seconds in November 2026; at that pace, five at a time check some 1,500
 * classes before the next minute's run starts, and at a slow second each,
 * 300. Overlapping runs are safe (see `recordChange`), but past that the
 * checks fall behind, and that is when to spread them out.
 */
import type { Crn, Term } from "@getthedamclass/shared/domain"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { classFullEmail, seatOpenedEmail } from "./emails"
import { Mailer } from "./Mailer"
import { isVacant, University } from "./University"
import { unsubscribeUrl } from "./unsubscribe"

/** How many classes are checked at the same time. */
const CONCURRENCY = 5

interface WatchedClass {
  readonly term: Term
  readonly crn: Crn
  readonly title: string
  /** As the last check saw it: 1 with a free seat, 0 when full. */
  readonly vacant: number
}

/** Every class somebody watches, with its recorded state. */
const watchedClasses = Effect.fn("pollClasses.watchedClasses")(function*() {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<WatchedClass>`
    SELECT term, crn, title, vacant FROM classes
    WHERE EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
  `
})

/**
 * Record the class's new state, if it is still recorded with the old one.
 * True if this changed the row; only then are the emails sent.
 *
 * Checking the old state in the same statement as the write is what keeps a
 * change from being emailed twice. Two runs can overlap (a slow one still
 * going when the next minute's starts) and both see the same change, but only
 * one of them changes the row. And if a subscribe records the class afresh
 * meanwhile (alerts.ts), the row may already hold the new state, so nothing
 * is sent for a change its new watcher never saw happen.
 */
const recordChange = Effect.fn("pollClasses.recordChange")(function*(watched: WatchedClass, vacant: boolean) {
  const sql = yield* SqlClient.SqlClient
  const changed = yield* sql`
    UPDATE classes SET vacant = ${vacant ? 1 : 0}
    WHERE term = ${watched.term} AND crn = ${watched.crn} AND vacant = ${vacant ? 0 : 1}
    RETURNING crn
  `
  return changed.length > 0
})

/** Everybody who watches the class: their address, and the key of their unsubscribe link. */
const watchersOf = Effect.fn("pollClasses.watchersOf")(function*(watched: WatchedClass) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ email: string; unsubscribeKey: string }>`
    SELECT accounts.email AS email, alerts.unsubscribe_key AS unsubscribeKey
    FROM alerts JOIN accounts ON accounts.id = alerts.account_id
    WHERE alerts.term = ${watched.term} AND alerts.crn = ${watched.crn}
  `
})

/**
 * Email one student about the change, with the link that stops their alert.
 *
 * A failed send is logged and not tried again. The change is already
 * recorded, so no later run sees it again, and trying again would mean
 * keeping track of who got which email; one missed alert is the smaller harm.
 */
const sendAlert = Effect.fn("pollClasses.sendAlert")(
  function*(watched: WatchedClass, vacant: boolean, to: string, unsubscribeKey: string) {
    const mailer = yield* Mailer
    const details = { title: watched.title, crn: watched.crn, unsubscribeUrl: yield* unsubscribeUrl(unsubscribeKey) }
    const email = vacant ? seatOpenedEmail(to, details) : classFullEmail(to, details)
    yield* mailer.send(email).pipe(
      Effect.catchTag("SendFailed", (error) => Effect.logWarning("Could not send a seat alert", error.reason))
    )
  }
)

/** Check one class, and if its state changed, record it and email its watchers. */
const checkClass = Effect.fn("pollClasses.checkClass")(
  function*(watched: WatchedClass) {
    const university = yield* University
    const seats = yield* university.seats(watched.term, watched.crn).pipe(
      Effect.catchTag(["ClassNotFound", "UniversityUnavailable"], (error) =>
        Effect.as(
          Effect.logWarning("Could not check a class; it keeps its recorded state until the next run", error.message),
          undefined
        ))
    )
    if (seats === undefined) {
      return
    }
    const vacant = isVacant(seats)
    if (vacant === (watched.vacant === 1)) {
      return
    }
    if (!(yield* recordChange(watched, vacant))) {
      return
    }
    for (const watcher of yield* watchersOf(watched)) {
      yield* sendAlert(watched, vacant, watcher.email, watcher.unsubscribeKey)
    }
  },
  (effect, watched) => Effect.annotateLogs(effect, { term: watched.term, crn: watched.crn })
)

/**
 * The check every minute. A failed query (the database down) ends the run as
 * a failure, which Cloudflare logs; the next minute's run starts afresh.
 */
export const pollClasses = Effect.fn("pollClasses")(function*() {
  const classes = yield* watchedClasses()
  yield* Effect.forEach(classes, checkClass, { concurrency: CONCURRENCY, discard: true })
})
