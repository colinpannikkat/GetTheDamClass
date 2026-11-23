import { Authentication, SignedIn } from "@getthedamclass/shared/Api"
import { type EmailAddress, NotSignedIn } from "@getthedamclass/shared/domain"
import { Clock, Duration, Effect, Layer, Redacted } from "effect"
import type { Digest } from "effect/crypto"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { hashSecret, randomKey } from "./secrets"

// Writing it on every request would turn every read into a write.
const LAST_USED_PRECISION = Duration.days(1)

const UNUSED_TOKEN_LIFETIME = Duration.days(365)

export const issueToken = Effect.fn("issueToken")(function*(accountId: number) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const token = yield* randomKey(32)
  const tokenHash = yield* hashSecret(token)
  yield* sql`
    INSERT INTO tokens (token_hash, account_id, created_at, last_used_at)
    VALUES (${tokenHash}, ${accountId}, ${now}, ${now})
  `
  return token
}, dieOnSqlError)

export const endToken = Effect.fn("endToken")(function*(tokenId: number) {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM tokens WHERE id = ${tokenId}`
}, dieOnSqlError)

// `last_used_at` can lag the real last use by `LAST_USED_PRECISION`, so tokens are kept that much longer.
export const deleteUnusedTokens = Effect.fn("deleteUnusedTokens")(function*() {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const unusedSince = now - Duration.toMillis(Duration.sum(UNUSED_TOKEN_LIFETIME, LAST_USED_PRECISION))
  const deleted = yield* sql`DELETE FROM tokens WHERE last_used_at <= ${unusedSince} RETURNING id`
  return deleted.length
})

const notSignedIn = new NotSignedIn({ message: "You're not signed in. Sign in with your email to continue." })

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function*() {
    const services = yield* Effect.context<SqlClient.SqlClient | Digest.Digest>()

    const findSignedIn = Effect.fn("Authentication.findSignedIn")(function*(token: string) {
      const sql = yield* SqlClient.SqlClient
      // A request without an `Authorization` header arrives as an empty token.
      if (token === "") {
        return yield* notSignedIn
      }
      const tokenHash = yield* hashSecret(token)
      const rows = yield* sql<{ tokenId: number; accountId: number; email: EmailAddress; lastUsedAt: number }>`
        SELECT tokens.id AS tokenId, tokens.account_id AS accountId, accounts.email AS email,
          tokens.last_used_at AS lastUsedAt
        FROM tokens JOIN accounts ON accounts.id = tokens.account_id
        WHERE tokens.token_hash = ${tokenHash}
      `
      const row = rows[0]
      if (row === undefined) {
        return yield* notSignedIn
      }
      const now = yield* Clock.currentTimeMillis
      const staleBefore = now - Duration.toMillis(LAST_USED_PRECISION)
      // The `WHERE` repeats the check, so of several requests arriving together only the first one writes.
      if (row.lastUsedAt <= staleBefore) {
        yield* sql`UPDATE tokens SET last_used_at = ${now} WHERE id = ${row.tokenId} AND last_used_at <= ${staleBefore}`
      }
      return SignedIn.of({ tokenId: row.tokenId, accountId: row.accountId, email: row.email })
    }, dieOnSqlError)

    return Authentication.of({
      bearer: (httpEffect, { credential }) =>
        findSignedIn(Redacted.value(credential)).pipe(
          Effect.provide(services),
          Effect.flatMap((signedIn) => Effect.provideService(httpEffect, SignedIn, signedIn))
        )
    })
  })
)
