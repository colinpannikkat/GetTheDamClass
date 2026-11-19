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
 * D1 has no transactions that stay open while the code runs (Effect's
 * `sql.withTransaction` fails on it), so nothing can read a row, decide, and
 * write it back while holding it. D1 can run a fixed list of statements as
 * one atomic batch (`D1Client.batch`), but this code does not use that.
 * Where two requests at the same moment could get in each other's way, the
 * check and the write are one statement instead (an `UPDATE ... WHERE`, or
 * an upsert with a `WHERE`), and SQLite runs each statement atomically.
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
