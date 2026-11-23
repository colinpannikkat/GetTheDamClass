import { Api } from "@getthedamclass/shared/Api"
import {
  CodeRecentlySent,
  type EmailAddress,
  EmailNotSent,
  InvalidCode,
  type SignInCode
} from "@getthedamclass/shared/domain"
import { Clock, Context, DateTime, Duration, Effect } from "effect"
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
const EMAIL_COUNTS_KEPT = Duration.days(7)

export class SignInEmailsPerDay extends Context.Service<SignInEmailsPerDay, number>()(
  "getthedamclass/SignInEmailsPerDay"
) {}

const utcDay = (millis: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(millis))

// Runs to the end even if the request is dropped (the popup closes as the student opens their inbox):
// cut off between storing and sending, the server would hold a code nobody got.
export const sendCode = Effect.fn("sendCode")(function*(email: EmailAddress) {
  const sql = yield* SqlClient.SqlClient
  const mailer = yield* Mailer
  const now = yield* Clock.currentTimeMillis
  const code = yield* randomCode
  const codeHash = yield* hashSecret(code)

  // One statement checks the cap and takes an email, so only one request gets the last one. It comes
  // first so that a request refused by the cap changes nothing.
  const cap = yield* SignInEmailsPerDay
  const day = utcDay(now)
  const taken = yield* sql<{ sent: number }>`
    INSERT INTO sign_in_emails (day, sent) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE
      SET sent = sign_in_emails.sent + 1
      WHERE sign_in_emails.sent < ${cap}
    RETURNING sent
  `
  if (taken.length === 0) {
    return yield* new EmailNotSent({ message: "Too many sign-in emails were sent today. Please try again tomorrow." })
  }

  // One statement checks the minute and stores the code, so two requests at once cannot both get through.
  const stored = yield* sql`
    INSERT INTO sign_in_codes (email, code_hash, sent_at, attempts, used)
    VALUES (${email}, ${codeHash}, ${now}, 0, 0)
    ON CONFLICT (email) DO UPDATE
      SET code_hash = excluded.code_hash, sent_at = excluded.sent_at, attempts = 0, used = 0
      WHERE sign_in_codes.sent_at <= ${now - Duration.toMillis(CODE_INTERVAL)}
    RETURNING email
  `
  if (stored.length === 0) {
    yield* sql`UPDATE sign_in_emails SET sent = sent - 1 WHERE day = ${day}`
    return yield* new CodeRecentlySent({
      message: "A code went to this address less than a minute ago. Please wait a minute before asking for another."
    })
  }

  if (taken[0]!.sent === cap) {
    yield* Effect.logWarning("Reached the day's cap on sign-in emails; no more codes go out until midnight UTC", {
      cap
    })
  }

  yield* mailer.send(signInCodeEmail(email, code)).pipe(
    Effect.catchTag("SendFailed", (error) =>
      Effect.gen(function*() {
        yield* Effect.logWarning("Could not send a sign-in code", error.reason)
        yield* sql`DELETE FROM sign_in_codes WHERE email = ${email} AND code_hash = ${codeHash}`
        return yield* new EmailNotSent({ message: "We couldn't send the email with your code. Please try again." })
      }))
  )
}, Effect.uninterruptible, dieOnSqlError)

export const signIn = Effect.fn("signIn")(function*(email: EmailAddress, code: SignInCode) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const invalidCode = new InvalidCode({
    message: "That code isn't right, or it has expired. Check the latest email, or ask for a new code."
  })

  // Counted before the code is checked, so guesses sent at once are all counted.
  const tried = yield* sql<{ codeHash: string; sentAt: number; attempts: number; used: number }>`
    UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = ${email}
    RETURNING code_hash AS codeHash, sent_at AS sentAt, attempts, used
  `
  const pending = tried[0]
  if (
    pending === undefined ||
    pending.used === 1 ||
    pending.attempts > MAX_ATTEMPTS ||
    now >= pending.sentAt + Duration.toMillis(CODE_LIFETIME) ||
    pending.codeHash !== (yield* hashSecret(code))
  ) {
    return yield* invalidCode
  }

  // If two requests got this far with the same code, only one marks it used. The row stays, so the
  // minute before another code can be sent still counts from this one.
  const used = yield* sql`
    UPDATE sign_in_codes SET used = 1
    WHERE email = ${email} AND code_hash = ${pending.codeHash} AND used = 0
    RETURNING email
  `
  if (used.length === 0) {
    return yield* invalidCode
  }

  // The `DO UPDATE` changes nothing; it makes `RETURNING` give the id of an existing account too.
  const accounts = yield* sql<{ id: number }>`
    INSERT INTO accounts (email, created_at) VALUES (${email}, ${now})
    ON CONFLICT (email) DO UPDATE SET email = excluded.email
    RETURNING id
  `
  return yield* issueToken(accounts[0]!.id)
}, dieOnSqlError)

export const deleteExpiredCodes = Effect.fn("deleteExpiredCodes")(function*() {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const deleted = yield* sql`
    DELETE FROM sign_in_codes WHERE sent_at <= ${now - Duration.toMillis(CODE_LIFETIME)} RETURNING email
  `
  return deleted.length
})

export const deleteOldEmailCounts = Effect.fn("deleteOldEmailCounts")(function*() {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const deleted = yield* sql`
    DELETE FROM sign_in_emails WHERE day < ${utcDay(now - Duration.toMillis(EMAIL_COUNTS_KEPT))} RETURNING day
  `
  return deleted.length
})

export const SignInHandlers = HttpApiBuilder.group(Api, "signIn", (handlers) =>
  handlers
    .handle("sendCode", ({ payload }) => sendCode(payload.email))
    .handle("signIn", ({ payload }) => Effect.map(signIn(payload.email, payload.code), (token) => ({ token }))))
