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
 *
 * And one for all addresses together: at most so many code emails a day
 * (`SignInEmailsPerDay`), so that asking for codes cannot use up the emails
 * the seat alerts need.
 */
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
/** How long the count of each day's sign-in emails is kept, for a maintainer to look back on. */
const EMAIL_COUNTS_KEPT = Duration.days(7)

/**
 * The most sign-in code emails the server sends in one day, from
 * configuration (`SIGN_IN_EMAILS_PER_DAY` in cloudflare.config.ts, which says
 * why it is set where it is).
 *
 * Cloudflare limits how many emails the account sends a day, and codes,
 * subscription confirmations and seat alerts all count. Anyone can ask for
 * codes without signing in, for any address, so without this cap a script
 * could use up the day's emails, and the seat alerts after it would be lost
 * (the check every minute does not send them again; see poll.ts). With it, a
 * flood can still stop new sign-ins for the rest of the day, but the students
 * already signed in keep getting their alerts.
 */
export class SignInEmailsPerDay extends Context.Service<SignInEmailsPerDay, number>()(
  "getthedamclass/SignInEmailsPerDay"
) {}

/**
 * The day the cap counts in: a calendar day in UTC, as an ISO date
 * ("2026-11-19"). Cloudflare's own day for its limit starts at another time
 * (`resets_at` in `cf email-sending limits get`; 13:48 UTC when this was
 * written), so one of its days holds the end of one of these and the start
 * of the next. That is good enough because the cap is only about half the
 * limit: a flood leaves the other half for alerts, and taking it all would
 * take the whole cap twice, just before and just after midnight UTC.
 */
const utcDay = (millis: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(millis))

/**
 * Email a new sign-in code to this address.
 *
 * Once started, it runs to the end, even if the request is dropped meanwhile.
 * That happens all the time: the student asks for a code and switches to
 * their inbox at once, which closes the extension's popup, and the browser
 * drops the request. Effect's router interrupts the handler of a dropped
 * request; cut off after storing the code and before sending it (or before
 * forgetting it when the email fails or the day's cap is reached), the
 * server would hold a code nobody received, and refuse another for a minute.
 * (index.ts keeps the Worker itself running until the handler is done.)
 */
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
    INSERT INTO sign_in_codes (email, code_hash, sent_at, attempts, used)
    VALUES (${email}, ${codeHash}, ${now}, 0, 0)
    ON CONFLICT (email) DO UPDATE
      SET code_hash = excluded.code_hash, sent_at = excluded.sent_at, attempts = 0, used = 0
      WHERE sign_in_codes.sent_at <= ${now - Duration.toMillis(CODE_INTERVAL)}
    RETURNING email
  `
  if (stored.length === 0) {
    return yield* new CodeRecentlySent({
      message: "A code went to this address less than a minute ago. Please wait a minute before asking for another."
    })
  }

  // Forget the code nobody received, so that asking again works straight
  // away instead of after a minute.
  const forgetCode = sql`DELETE FROM sign_in_codes WHERE email = ${email} AND code_hash = ${codeHash}`

  // Count this email in today's total, unless the total has reached the cap.
  // As above, the check and the write are one statement: when one email is
  // left and many requests arrive together, only one of them counts it, and
  // only that one sends. It returns the new total only when it counted.
  //
  // What counts is every email the server tries to send. This comes after
  // storing the code, so that a request refused for the minute above never
  // counts; one refused by the cap changes nothing. A send that fails stays
  // counted: it is rare, Cloudflare may have counted it too, and counting one
  // too many only leaves alerts more room. (Storing first does replace an
  // older code of this address, so a refusal here loses it, as a failed send
  // does.)
  const cap = yield* SignInEmailsPerDay
  const counted = yield* sql<{ sent: number }>`
    INSERT INTO sign_in_emails (day, sent) VALUES (${utcDay(now)}, 1)
    ON CONFLICT (day) DO UPDATE
      SET sent = sign_in_emails.sent + 1
      WHERE sign_in_emails.sent < ${cap}
    RETURNING sent
  `
  if (counted.length === 0) {
    yield* forgetCode
    return yield* new EmailNotSent({ message: "Too many sign-in emails were sent today. Please try again tomorrow." })
  }
  // Only the request that took the last email sees this total, so the line is
  // logged once a day.
  if (counted[0]!.sent === cap) {
    yield* Effect.logWarning("Reached the day's cap on sign-in emails; no more codes go out until midnight UTC", {
      cap
    })
  }

  yield* mailer.send(signInCodeEmail(email, code)).pipe(
    Effect.catchTag("SendFailed", (error) =>
      Effect.gen(function*() {
        yield* Effect.logWarning("Could not send a sign-in code", error.reason)
        yield* forgetCode
        return yield* new EmailNotSent({ message: "We couldn't send the email with your code. Please try again." })
      }))
  )
}, Effect.uninterruptible, dieOnSqlError)

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
  const tried = yield* sql<{ codeHash: string; sentAt: number; attempts: number; used: number }>`
    UPDATE sign_in_codes SET attempts = attempts + 1 WHERE email = ${email}
    RETURNING code_hash AS codeHash, sent_at AS sentAt, attempts, used
  `
  const pending = tried[0]
  // Every way a code can fail looks the same to the caller (see InvalidCode).
  if (
    pending === undefined ||
    pending.used === 1 ||
    pending.attempts > MAX_ATTEMPTS ||
    now >= pending.sentAt + Duration.toMillis(CODE_LIFETIME) ||
    pending.codeHash !== (yield* hashSecret(code))
  ) {
    return yield* invalidCode
  }

  // Use the code up. If two requests got this far with the same code, only
  // one of them marks it used, and only that one signs in. The row stays, so
  // the minute before another code can be sent still counts from this one.
  const used = yield* sql`
    UPDATE sign_in_codes SET used = 1
    WHERE email = ${email} AND code_hash = ${pending.codeHash} AND used = 0
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

/**
 * Remove the codes that have expired, for the daily job (cleanup.ts). Nothing
 * is lost: an expired code signs nobody in, and its row stopped counting for
 * the one-minute wait long before. How many were removed.
 */
export const deleteExpiredCodes = Effect.fn("deleteExpiredCodes")(function*() {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const deleted = yield* sql`
    DELETE FROM sign_in_codes WHERE sent_at <= ${now - Duration.toMillis(CODE_LIFETIME)} RETURNING email
  `
  return deleted.length
})

/**
 * Remove the counts of sign-in emails older than a week, for the daily job
 * (cleanup.ts). Only today's count is used; the week before is kept so a
 * maintainer can see how many went out on the days the logs still cover.
 * How many were removed.
 */
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
