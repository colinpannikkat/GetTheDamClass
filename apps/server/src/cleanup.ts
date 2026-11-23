import type { Term } from "@getthedamclass/shared/domain"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { deleteExpiredCodes, deleteOldEmailCounts } from "./signIn"
import { closedTerms, todayInOregon } from "./termRule"
import { deleteUnusedTokens } from "./tokens"

// A class with a deadline goes by its deadline alone, even once its term is closed (the owner's rule).
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

// Closed terms only: `subscribe` records a class and then adds the alert in two statements, and removing
// the class in between would make it fail. In an open term `subscribe` re-records a stale class anyway.
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

const deleteEndedAlertsAndClasses = Effect.fn("cleanup.deleteEndedAlertsAndClasses")(function*() {
  const closed = yield* closedTerms()
  const alerts = yield* deleteEndedAlerts(closed, yield* todayInOregon)
  const classes = yield* deleteUnwatchedClasses(closed)
  return { alerts, classes }
})

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
