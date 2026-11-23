// D1 has no transactions that stay open while code runs, so where concurrent requests could interfere
// the check and the write are one statement (`UPDATE ... WHERE`, or an upsert with a `WHERE`).
import { D1Client } from "@effect/sql-d1"
import { Effect } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"

export const layerD1 = (db: D1Database) => D1Client.layer({ db })

export const dieOnSqlError = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, SqlError>, R> =>
  Effect.catch(effect, (error) =>
    isSqlError(error)
      ? Effect.die(error)
      : Effect.fail(error as Exclude<E, SqlError>))
