// Input that fails these schemas gets an empty HTTP 400, with no sentence for the student, so the
// extension checks what a student types with the same schemas before calling.
import { Context, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import {
  AddDeadlinePassed,
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
  TermNotOpen,
  UniversityUnavailable
} from "./domain"

// Only the server uses this; it is declared here because the middleware's type names it.
export class SignedIn extends Context.Service<SignedIn, {
  readonly accountId: number
  readonly email: EmailAddress
  readonly tokenId: number
}>()("getthedamclass/SignedIn") {}

export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: SignedIn }>()(
  "getthedamclass/Authentication",
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: NotSignedIn
  }
) {}

class SignInGroup extends HttpApiGroup.make("signIn").add(
  HttpApiEndpoint.post("sendCode", "/sign-in/code", {
    payload: Schema.Struct({ email: EmailAddress }),
    error: [CodeRecentlySent, EmailNotSent]
  }),
  HttpApiEndpoint.post("signIn", "/sign-in", {
    payload: Schema.Struct({ email: EmailAddress, code: SignInCode }),
    success: Schema.Struct({ token: Schema.String }),
    error: InvalidCode
  })
) {}

class AccountGroup extends HttpApiGroup.make("account").add(
  HttpApiEndpoint.post("signOut", "/sign-out"),
  HttpApiEndpoint.delete("deleteAccount", "/account")
).middleware(Authentication) {}

class AlertsGroup extends HttpApiGroup.make("alerts").add(
  HttpApiEndpoint.get("list", "/alerts", {
    success: Schema.Array(Alert)
  }),
  HttpApiEndpoint.post("subscribe", "/alerts", {
    payload: Schema.Struct({ term: Term, crn: Crn }),
    success: Alert,
    error: [AlreadySubscribed, ClassNotFound, TermNotOpen, AddDeadlinePassed, UniversityUnavailable]
  }),
  HttpApiEndpoint.delete("unsubscribe", "/alerts/:term/:crn", {
    params: { term: Term, crn: Crn },
    error: NotSubscribed
  })
).middleware(Authentication) {}

export class Api extends HttpApi.make("getthedamclass").add(SignInGroup, AccountGroup, AlertsGroup) {}
