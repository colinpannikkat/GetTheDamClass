/**
 * The daily job: removing what is no longer needed.
 *
 * - Sign-in codes that have expired, tokens nobody has used for a year, and
 *   the counts of sign-in emails older than a week.
 * - Alerts that have ended (see termRule.ts): those whose class's add
 *   deadline has passed, and those of a class without a deadline once the
 *   university lists its term as "View Only". Nobody is emailed about it; the
 *   alert just leaves the student's list.
 * - Classes nobody watches, once the university lists their term as "View
 *   Only".
 *
 * Alerts and classes depend on the university's term list, which this job
 * asks for. If it cannot be read, none of them are removed, and the next
 * day's run tries again. Codes, tokens and counts do not depend on the
 * university and are removed regardless.
 *
 * Each removal is one statement over the whole table. The run ends with one
 * line in the log saying how much each removed.
 */
import type { Term } from "@getthedamclass/shared/domain"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { deleteExpiredCodes, deleteOldEmailCounts } from "./signIn"
import { closedTerms, todayInOregon } from "./termRule"
import { deleteUnusedTokens } from "./tokens"

/**
 * Remove the alerts whose class's add deadline was before `today`, and those
 * of a class without a deadline (NULL) whose term is closed. How many were
 * removed.
 *
 * A class with a deadline goes by its deadline alone, even once its term is
 * closed: that is the project owner's rule.
 */
const deleteEndedAlerts = Effect.fn("cleanup.deleteEndedAlerts")(
  function*(closed: ReadonlyArray<Term>, today: string) {
    const sql = yield* SqlClient.SqlClient
    const deleted = yield* sql`
      DELETE FROM alerts
      WHERE EXISTS (
        SELECT 1 FROM classes
        WHERE classes.term = alerts.term AND classes.crn = alerts.crn
          AND (classes.add_deadline < ${today} OR (classes.add_deadline IS NULL AND classes.term IN ${sql.in(closed)}))
      )
      RETURNING crn
    `
    return deleted.length
  }
)

/**
 * Remove the classes nobody watches, in closed terms. How many were removed.
 *
 * Only those: `subscribe` (alerts.ts) records a class and then adds the alert
 * in two statements, and removing an unwatched class in between would make
 * that subscribe fail. A closed term takes no subscribes, so its classes can
 * go safely. In an open term an unwatched class is harmless: subscribe takes
 * it as out of date and records it afresh.
 */
const deleteUnwatchedClasses = Effect.fn("cleanup.deleteUnwatchedClasses")(
  function*(closed: ReadonlyArray<Term>) {
    const sql = yield* SqlClient.SqlClient
    const deleted = yield* sql`
      DELETE FROM classes
      WHERE term IN ${sql.in(closed)}
        AND NOT EXISTS (SELECT 1 FROM alerts WHERE alerts.term = classes.term AND alerts.crn = classes.crn)
      RETURNING crn
    `
    return deleted.length
  }
)

/** Read the term list, and remove the alerts and classes that have ended by it. */
const deleteEndedAlertsAndClasses = Effect.fn("cleanup.deleteEndedAlertsAndClasses")(function*() {
  const closed = yield* closedTerms()
  const alerts = yield* deleteEndedAlerts(closed, yield* todayInOregon)
  const classes = yield* deleteUnwatchedClasses(closed)
  return { alerts, classes }
})

/** The daily job. */
export const cleanup = Effect.fn("cleanup")(function*() {
  const signInCodes = yield* deleteExpiredCodes()
  const signInEmailCounts = yield* deleteOldEmailCounts()
  const tokens = yield* deleteUnusedTokens()
  const ended = yield* deleteEndedAlertsAndClasses().pipe(
    Effect.catchTag("UniversityUnavailable", () =>
      Effect.as(
        Effect.logWarning("Could not read the term list, so no alerts or classes were removed today"),
        { alerts: 0, classes: 0 }
      ))
  )
  yield* Effect.logInfo("Daily cleanup done. Removed:", { signInCodes, signInEmailCounts, tokens, ...ended })
})
