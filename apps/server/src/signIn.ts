/**
 * Signing in, and the `signIn` endpoints of the API.
 *
 * There are no passwords. A student proves they own an inbox:
 *
 *   1. `sendCode`: the server emails a fresh six-digit code to the address.
 *   2. `signIn`: the student types the code. If it is right, the server
 *      creates the account (if the address is new) and returns a sign-in
 *      token for this browser (see tokens.ts).
 *
 * Signing up, signing in and "I forgot" are all these same two steps, and no
 * account exists until a code is confirmed.
 *
 * The rules, all counted from when the code was sent:
 * - one code per address per minute (a new code replaces the old one);
 * - a code works for 15 minutes, and once;
 * - five tries with a wrong code cancel it.
 */
import { Api } from "@getthedamclass/shared/Api"
import {
  CodeRecentlySent,
  type EmailAddress,
  EmailNotSent,
  InvalidCode,
  type SignInCode
} from "@getthedamclass/shared/domain"
import { Clock, Duration, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { signInCodeEmail } from "./emails"
import { Mailer } from "./Mailer"
import { hashSecret, randomCode } from "./secrets"
import { issueToken } from "./tokens"

const CODE_INTERVAL = Duration.minutes(1)
const CODE_LIFETIME = Duration.minutes(15)
const MAX_ATTEMPTS = 5

/** Email a new sign-in code to this address. */
export const sendCode = Effect.fn("sendCode")(function*(email: EmailAddress) {
  const sql = yield* SqlClient.SqlClient
  const mailer = yield* Mailer
  const now = yield* Clock.currentTimeMillis
  const code = yield* randomCode
  const codeHash = yield* hashSecret(code)

  // Store the new code, unless one went to this address less than a minute
  // ago. One statement does both the check and the write, so two requests at
  // the same moment cannot both get through. It returns a row only when it
  // stored the code.
  const stored = yield* sql`
    INSERT INTO sign_in_codes (email, code_hash, sent_at, attempts)
    VALUES (${email}, ${codeHash}, ${now}, 0)
    ON CONFLICT (email) DO UPDATE
      SET code_hash = excluded.code_hash, sent_at = excluded.sent_at, attempts = 0
      WHERE sign_in_codes.sent_at <= ${now - Duration.toMillis(CODE_INTERVAL)}
    RETURNING email
  `
  if (stored.length === 0) {
    return yield* new CodeRecentlySent({
      message: "We just sent a code to this address. Check your inbox, or wait a minute to ask for another."
    })
  }

  yield* mailer.send(signInCodeEmail(email, code)).pipe(
    Effect.catchTag("SendFailed", (error) =>
      Effect.gen(function*() {
        yield* Effect.logWarning("Could not send a sign-in code", error.reason)
        // Forget the code nobody received, so asking again works straight
        // away instead of after a minute.
        yield* sql`DELETE FROM sign_in_codes WHERE email = ${email} AND code_hash = ${codeHash}`
        return yield* new EmailNotSent({ message: "We couldn't send the email with your code. Please try again." })
      }))
  )
}, dieOnSqlError)

/** Check a code, and if it is right, return a new sign-in token for its address's account. */
export const signIn = Effect.fn("signIn")(function*(email: EmailAddress, code: SignInCode) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const invalidCode = new InvalidCode({
    message: "That code isn't right, or it has expired. Check the latest email, or ask for a new code."
  })

  // Count the try before looking at the code. Counting only wrong ones after
  // checking would let many guesses sent at once all be checked before any of
  // them was counted.
  const tried = yield* sql<{ codeHash: string; sentAt: number; attempts: number }>`
    UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = ${email}
    RETURNING code_hash AS codeHash, sent_at AS sentAt, attempts
  `
  const pending = tried[0]
  // Every way a code can fail looks the same to the caller (see InvalidCode).
  if (
    pending === undefined ||
    pending.attempts > MAX_ATTEMPTS ||
    now >= pending.sentAt + Duration.toMillis(CODE_LIFETIME) ||
    pending.codeHash !== (yield* hashSecret(code))
  ) {
    return yield* invalidCode
  }

  // Use the code up. If two requests got this far with the same code, only
  // one of them deletes it, and only that one signs in.
  const used = yield* sql`
    DELETE FROM sign_in_codes WHERE email = ${email} AND code_hash = ${pending.codeHash}
    RETURNING email
  `
  if (used.length === 0) {
    return yield* invalidCode
  }

  // The account for this address, created if it is new. (The `DO UPDATE`
  // changes nothing; it is there so that `RETURNING` gives the id of an
  // existing account too.)
  const accounts = yield* sql<{ id: number }>`
    INSERT INTO accounts (email, created_at) VALUES (${email}, ${now})
    ON CONFLICT (email) DO UPDATE SET email = excluded.email
    RETURNING id
  `
  return yield* issueToken(accounts[0]!.id)
}, dieOnSqlError)

export const SignInHandlers = HttpApiBuilder.group(Api, "signIn", (handlers) =>
  handlers
    .handle("sendCode", ({ payload }) => sendCode(payload.email))
    .handle("signIn", ({ payload }) => Effect.map(signIn(payload.email, payload.code), (token) => ({ token }))))
