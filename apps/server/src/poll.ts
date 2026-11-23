import type { Crn, Term } from "@getthedamclass/shared/domain"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { classFullEmail, seatOpenedEmail } from "./emails"
import { Mailer } from "./Mailer"
import { isVacant, University } from "./University"
import { unsubscribeUrl } from "./unsubscribe"

// A cron run can wait on at most 6 connections at once.
const CONCURRENCY = 5

interface WatchedClass {
  readonly term: Term
  readonly crn: Crn
  readonly title: string
  readonly vacant: number
}

const watchedClasses = Effect.fn("pollClasses.watchedClasses")(function*() {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<WatchedClass>`
    SELECT term, crn, title, vacant FROM classes
    WHERE EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
  `
})

const Watchers = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ email: Schema.String, unsubscribeKey: Schema.String }))
)

// Checking the old state in the write keeps overlapping runs from emailing a change twice, and reading
// the watchers in the same statement emails exactly those watching when the change is recorded.
const recordChange = Effect.fn("pollClasses.recordChange")(function*(watched: WatchedClass, nowVacant: boolean) {
  const sql = yield* SqlClient.SqlClient
  const changed = yield* sql<{ watchers: unknown }>`
    UPDATE classes SET vacant = ${nowVacant ? 1 : 0}
    WHERE term = ${watched.term} AND crn = ${watched.crn} AND vacant = ${nowVacant ? 0 : 1}
    RETURNING (
      SELECT json_group_array(json_object('email', accounts.email, 'unsubscribeKey', alerts.unsubscribe_key))
      FROM alerts JOIN accounts ON accounts.id = alerts.account_id
      WHERE alerts.term = classes.term AND alerts.crn = classes.crn
    ) AS watchers
  `
  if (changed.length === 0) {
    return undefined
  }
  return yield* Effect.orDie(Schema.decodeUnknownEffect(Watchers)(changed[0]!.watchers))
})

// A failed send is logged and not retried: the change is already recorded, so no later run sees it.
const sendAlert = Effect.fn("pollClasses.sendAlert")(
  function*(watched: WatchedClass, nowVacant: boolean, to: string, unsubscribeKey: string) {
    const mailer = yield* Mailer
    const details = { title: watched.title, crn: watched.crn, unsubscribeUrl: yield* unsubscribeUrl(unsubscribeKey) }
    const email = nowVacant ? seatOpenedEmail(to, details) : classFullEmail(to, details)
    yield* mailer.send(email).pipe(
      Effect.catchTag("SendFailed", (error) => Effect.logWarning("Could not send a seat alert", error.reason))
    )
  }
)

type Outcome = "unchanged" | "changed" | "failed"

// Never fails: with `Effect.forEach`, one failure would interrupt the other classes mid-email.
const checkClass = Effect.fn("pollClasses.checkClass")(
  function*(watched: WatchedClass) {
    const university = yield* University
    const seats = yield* university.seats(watched.term, watched.crn).pipe(
      Effect.catchTags({
        ClassNotFound: () =>
          Effect.as(
            Effect.logWarning("Could not check a class: the university has no class with this CRN in this term"),
            undefined
          ),
        UniversityUnavailable: () => Effect.succeed(undefined)
      })
    )
    if (seats === undefined) {
      return "failed"
    }
    const nowVacant = isVacant(seats)
    // An unchanged class costs no database statement, which keeps a run within D1's per-run query limit.
    if (nowVacant === (watched.vacant === 1)) {
      return "unchanged"
    }
    const watchers = yield* recordChange(watched, nowVacant)
    if (watchers === undefined) {
      return "unchanged"
    }
    for (const watcher of watchers) {
      yield* sendAlert(watched, nowVacant, watcher.email, watcher.unsubscribeKey)
    }
    return "changed"
  },
  (effect, watched) =>
    effect.pipe(
      Effect.catchCause((cause) => Effect.as(Effect.logError("Checking a class failed", cause), "failed" as const)),
      Effect.annotateLogs({ term: watched.term, crn: watched.crn })
    )
)

export const pollClasses = Effect.fn("pollClasses")(function*() {
  const classes = yield* watchedClasses()
  const outcomes: ReadonlyArray<Outcome> = yield* Effect.forEach(classes, checkClass, { concurrency: CONCURRENCY })
  const count = (outcome: Outcome) => outcomes.filter((each) => each === outcome).length
  yield* Effect.logInfo("Checked the watched classes:", {
    checked: classes.length,
    changed: count("changed"),
    failed: count("failed")
  })
})
