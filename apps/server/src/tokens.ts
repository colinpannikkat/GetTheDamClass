/**
 * Sign-in tokens: issuing one when a student signs in, checking the one that
 * comes with every request (the `Authentication` middleware), and ending one.
 *
 * Each browser gets its own token, so signing in somewhere new leaves the
 * others signed in. A token ends when its browser signs out, or when the
 * account is deleted (the database removes its tokens with it). The database
 * keeps only a hash of each token; the token itself exists only in the
 * browser that holds it.
 */
import { Authentication, SignedIn } from "@getthedamclass/shared/Api"
import { type EmailAddress, NotSignedIn } from "@getthedamclass/shared/domain"
import { Clock, Duration, Effect, Layer, Redacted } from "effect"
import type { Digest } from "effect/crypto"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { hashSecret, randomKey } from "./secrets"

/**
 * How stale `last_used_at` may get before a request updates it. Writing it on
 * every request would turn every read into a write; once a day is plenty for
 * removing tokens nobody has used for a year.
 */
const LAST_USED_PRECISION = Duration.days(1)

/** Create a token for this account, and return it. This is the only time it is seen. */
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

/** End one token: that browser is signed out. */
export const endToken = Effect.fn("endToken")(function*(tokenId: number) {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM tokens WHERE id = ${tokenId}`
}, dieOnSqlError)

const notSignedIn = new NotSignedIn({ message: "You're not signed in. Sign in with your email to continue." })

/**
 * The server side of `Authentication` (declared in packages/shared): finds
 * the account a request's token belongs to, and hands it to the endpoint as
 * `SignedIn`. A missing, unknown or ended token is `NotSignedIn`.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function*() {
    // A middleware cannot ask for services on each request, so it takes the
    // ones it needs (the database, hashing) once, when the server starts.
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
      if (now - row.lastUsedAt >= Duration.toMillis(LAST_USED_PRECISION)) {
        yield* sql`UPDATE tokens SET last_used_at = ${now} WHERE id = ${row.tokenId}`
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
