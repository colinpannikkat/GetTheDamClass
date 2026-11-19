/**
 * The daily job: removing what is no longer needed.
 *
 * - Sign-in codes that have expired, and tokens nobody has used for a year.
 * - Alerts that have ended by the term rule (termRule.ts): their class's add
 *   deadline has passed, or their term is no longer open. Nobody is emailed
 *   about it; the alert just leaves the student's list.
 * - Classes nobody watches, once their term is no longer open.
 *
 * Alerts and classes depend on the university's term list. If it cannot be
 * read, none of them are removed, and the next day's run tries again. Codes
 * and tokens do not depend on the university and are removed regardless.
 *
 * Each removal is one statement over the whole table.
 */
import type { Term } from "@getthedamclass/shared/domain"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { deleteExpiredCodes } from "./signIn"
import { openTerms, todayInOregon } from "./termRule"
import { deleteUnusedTokens } from "./tokens"

/**
 * Remove the alerts whose class's add deadline was before `today`, and every
 * alert in a term that is not open. A class without dates has no deadline
 * (NULL, which `<` never matches), so only its term closing ends its alerts.
 */
const deleteEndedAlerts = Effect.fn("cleanup.deleteEndedAlerts")(
  function*(open: ReadonlyArray<Term>, today: string) {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      DELETE FROM alerts
      WHERE term NOT IN ${sql.in(open)}
        OR EXISTS (
          SELECT 1 FROM classes
          WHERE classes.term = alerts.term AND classes.crn = alerts.crn AND classes.add_deadline < ${today}
        )
    `
  }
)

/**
 * Remove the classes nobody watches, in terms that are not open.
 *
 * Only those: `subscribe` (alerts.ts) records a class and then adds the alert
 * in two statements, and removing an unwatched class in between would make
 * that subscribe fail. A term that is not open takes no subscribes, so its
 * classes can go safely. In an open term an unwatched class is harmless:
 * subscribe takes it as out of date and records it afresh.
 *
 * Run after `deleteEndedAlerts`, every class of a term that is not open is
 * unwatched already; the `NOT EXISTS` keeps this statement right on its own.
 */
const deleteUnwatchedClasses = Effect.fn("cleanup.deleteUnwatchedClasses")(
  function*(open: ReadonlyArray<Term>) {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      DELETE FROM classes
      WHERE term NOT IN ${sql.in(open)}
        AND NOT EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
    `
  }
)

/** The daily job. */
export const cleanup = Effect.fn("cleanup")(function*() {
  yield* deleteExpiredCodes()
  yield* deleteUnusedTokens()

  const open = yield* openTerms().pipe(
    Effect.catchTag("UniversityUnavailable", () =>
      Effect.as(Effect.logWarning("Could not read the term list, so no alerts or classes were removed today"), undefined))
  )
  if (open === undefined) {
    return
  }
  // A list with no open term at all has never been seen (see termRule.ts),
  // and taking it at its word would end every alert. More likely the
  // university is having trouble, so wait for the next day's list.
  if (open.length === 0) {
    return yield* Effect.logWarning("The term list has no open term, so no alerts or classes were removed today")
  }
  yield* deleteEndedAlerts(open, yield* todayInOregon)
  yield* deleteUnwatchedClasses(open)
})
