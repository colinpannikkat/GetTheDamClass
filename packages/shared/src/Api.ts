/**
 * The server's API, defined once with Effect's `HttpApi`: every endpoint's
 * method, path, input, reply and errors. The server implements it
 * (`apps/server`), and a client gets typed functions for it from
 * `HttpApiClient`, with every request and reply checked against the schemas.
 *
 * Signing in: ask for a code by email (`sendCode`), then trade the code for a
 * sign-in token (`signIn`). Every other endpoint needs that token in the
 * `Authorization: Bearer <token>` header, and answers `NotSignedIn` (HTTP 401)
 * without a valid one.
 *
 * Input that does not fit the schemas (an email without "@", a code that is
 * not six digits, a CRN that is not digits) never reaches the server's code:
 * it is refused with an empty HTTP 400, without a sentence for the student.
 * So the extension must check what a student types with the same schemas
 * (`EmailAddress` and `SignInCode` in domain.ts) before calling, and show its
 * own sentence when they refuse it. Terms and CRNs need no such check: the
 * extension reads them from the university's page, and nobody types them.
 */
import { Context, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import {
  Alert,
  AlreadySubscribed,
  ClassNotFound,
  CodeRecentlySent,
  Crn,
  EmailAddress,
  EmailNotSent,
  InvalidCode,
  NotSignedIn,
  NotSubscribed,
  SignInCode,
  Term,
  UniversityUnavailable
} from "./domain"

/**
 * Who sent the request, for the server's handlers of signed-in endpoints. The
 * `Authentication` middleware below finds it from the token. (Only the server
 * uses this; it is declared here because the middleware's type names it.)
 */
export class SignedIn extends Context.Service<SignedIn, {
  readonly accountId: number
  readonly email: EmailAddress
  /** The token this request came with, so signing out can end just that one. */
  readonly tokenId: number
}>()("getthedamclass/SignedIn") {}

/** Checks the `Authorization: Bearer` token of every endpoint it is added to. */
export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: SignedIn }>()(
  "getthedamclass/Authentication",
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: NotSignedIn
  }
) {}

class SignInGroup extends HttpApiGroup.make("signIn").add(
  /** Email a fresh six-digit code to this address. It works once, for 15 minutes. */
  HttpApiEndpoint.post("sendCode", "/sign-in/code", {
    payload: Schema.Struct({ email: EmailAddress }),
    error: [CodeRecentlySent, EmailNotSent]
  }),
  /**
   * Trade the emailed code for a sign-in token, creating the account if this
   * address is new. Each browser keeps its own token.
   */
  HttpApiEndpoint.post("signIn", "/sign-in", {
    payload: Schema.Struct({ email: EmailAddress, code: SignInCode }),
    success: Schema.Struct({ token: Schema.String }),
    error: InvalidCode
  })
) {}

class AccountGroup extends HttpApiGroup.make("account").add(
  /** End this browser's token. Other browsers stay signed in. */
  HttpApiEndpoint.post("signOut", "/sign-out"),
  /** Delete the account, its alerts, and every browser's token. */
  HttpApiEndpoint.delete("deleteAccount", "/account")
).middleware(Authentication) {}

class AlertsGroup extends HttpApiGroup.make("alerts").add(
  /** Every class the account gets alerts for. */
  HttpApiEndpoint.get("list", "/alerts", {
    success: Schema.Array(Alert)
  }),
  /** Start alerts for a class. A confirmation email follows. */
  HttpApiEndpoint.post("subscribe", "/alerts", {
    payload: Schema.Struct({ term: Term, crn: Crn }),
    success: Alert,
    error: [AlreadySubscribed, ClassNotFound, UniversityUnavailable]
  }),
  /** Stop alerts for a class. */
  HttpApiEndpoint.delete("unsubscribe", "/alerts/:term/:crn", {
    params: { term: Term, crn: Crn },
    error: NotSubscribed
  })
).middleware(Authentication) {}

export class Api extends HttpApi.make("getthedamclass").add(SignInGroup, AccountGroup, AlertsGroup) {}
