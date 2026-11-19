/**
 * The database, seen from the code: Effect's `SqlClient`, which runs SQL
 * written as template strings (`` sql`SELECT ... WHERE id = ${id}` ``; every
 * `${}` is sent as a parameter, never pasted into the SQL).
 *
 * In the Worker the client talks to D1 (`@effect/sql-d1`). The tests give the
 * same code a real SQLite database in Node instead (test/TestDatabase.ts),
 * with the same tables, built by the same migrations. The tables themselves
 * are described in migrations/.
 *
 * D1 runs every statement on its own and has no transactions, so the code
 * never relies on two statements happening together: where that would matter,
 * it does the work in one statement.
 */
import { D1Client } from "@effect/sql-d1"
import { Effect } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"

/** The database layer for the Worker, on its D1 binding (`DB` in cloudflare.config.ts). */
export const layerD1 = (db: D1Database) => D1Client.layer({ db })

/**
 * A failed query is an outage or a bug, never something a student can fix,
 * so it is not one of the API's errors: it ends the request as HTTP 500, and
 * Effect logs it. Add this to every function whose queries an endpoint runs.
 */
export const dieOnSqlError = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, SqlError>, R> =>
  Effect.catch(effect, (error) =>
    isSqlError(error)
      ? Effect.die(error)
      // TypeScript cannot narrow a generic type this way: what is left is
      // every error but `SqlError`, and the cast only says so.
      : Effect.fail(error as Exclude<E, SqlError>))
