import {
  type CodeRecentlySent,
  type EmailAddress,
  type EmailNotSent,
  NotSignedIn,
  type SignInCode
} from "@getthedamclass/shared/domain"
import { Clock, Data, Duration, Effect } from "effect"
import { type Account, AccountStore, type CodeRequest } from "./AccountStore"
import { Api } from "./Api"
import { type ClassId, type NetworkError, sameClass, type ServerError } from "./domain"

const signedInAccount = Effect.gen(function*() {
  const store = yield* AccountStore
  const saved = yield* store.get
  if (saved.status === "signedOut") {
    return yield* new NotSignedIn({ message: "Sign in to get alerts." })
  }
  return saved
})

const withToken = <A, E, R>(account: Account, call: (token: string) => Effect.Effect<A, E | NotSignedIn, R>) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    return yield* call(account.token).pipe(Effect.tapErrorTag("NotSignedIn", () => store.forgetToken(account.token)))
  })

export class CodeNotSent extends Data.TaggedError("CodeNotSent")<{
  readonly reason: CodeRecentlySent | EmailNotSent | NetworkError | ServerError
  readonly codeStepFor: EmailAddress | undefined
}> {}

export class CodeRequestOvertaken extends Data.TaggedError("CodeRequestOvertaken")<{}> {}

// Saved before the server is asked: the popup often closes before the answer, and must reopen at the
// code step. A refusal undoes it only while it is still the saved request.
export const requestCode = Effect.fn("requestCode")(function*(email: EmailAddress) {
  const api = yield* Api
  const store = yield* AccountStore
  const { codeRequest: earlier } = yield* store.get
  const request: CodeRequest = { email, requestedAt: yield* Clock.currentTimeMillis }
  yield* store.saveCodeRequest(request)
  yield* api.sendCode(email).pipe(Effect.catch((reason) =>
    Effect.gen(function*() {
      const next = afterRefusal(reason, request, earlier)
      if (yield* store.replaceCodeRequest(request, next)) {
        return yield* new CodeNotSent({ reason, codeStepFor: next?.email })
      }
      return yield* new CodeRequestOvertaken()
    })
  ))
})

const afterRefusal = (
  reason: CodeNotSent["reason"],
  request: CodeRequest,
  earlier: CodeRequest | undefined
): CodeRequest | undefined => {
  switch (reason._tag) {
    case "CodeRecentlySent":
      return earlier?.email === request.email ? earlier : request
    case "EmailNotSent":
      // Usually the server replaced the earlier code and then forgot the new one when its email failed.
      return undefined
    case "NetworkError":
    case "ServerError":
      return earlier
  }
}

export const signIn = Effect.fn("signIn")(function*(email: EmailAddress, code: SignInCode) {
  const api = yield* Api
  const store = yield* AccountStore
  const token = yield* api.signIn(email, code)
  yield* store.save(email, token)
})

export const changeEmail = Effect.fn("changeEmail")(function*() {
  const store = yield* AccountStore
  yield* store.forgetCodeRequest
})

// Short: this browser has signed out already, and the wait only delays the popup's note.
const SIGN_OUT_SERVER_LIMIT = Duration.seconds(5)

// Forgets first, so signing out never depends on the server.
export const signOut = Effect.fn("signOut")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const saved = yield* store.get
  yield* store.clear
  if (saved.status === "signedIn") {
    yield* api.signOut(saved.token).pipe(Effect.timeout(SIGN_OUT_SERVER_LIMIT), Effect.ignore)
  }
})

export const deleteAccount = Effect.fn("deleteAccount")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.deleteAccount(token))
  yield* store.clear
})

export const subscribe = Effect.fn("subscribe")(function*(classId: ClassId) {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.subscribe(token, classId)).pipe(
    Effect.catchTag("AlreadySubscribed", () => Effect.void)
  )
  yield* store.watch(account.email, [classId])
})

export const unsubscribe = Effect.fn("unsubscribe")(function*(classId: ClassId) {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.unsubscribe(token, classId)).pipe(
    Effect.catchTag("NotSubscribed", () => Effect.void)
  )
  yield* store.unwatch(account.email, [classId])
})

export const listAlerts = Effect.fn("listAlerts")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  const alerts = yield* withToken(account, (token) => api.listAlerts(token))
  // The server's list is the truth as of when we asked, so only differences from what was saved then are
  // undone: a class started or stopped while it answered is newer, and left alone.
  const isListed = (watched: ClassId) => alerts.some((alert) => sameClass(alert, watched))
  const wasSaved = (alert: ClassId) => account.watching.some((watched) => sameClass(watched, alert))
  yield* store.unwatch(account.email, account.watching.filter((watched) => !isListed(watched)))
  yield* store.watch(account.email, alerts.filter((alert) => !wasSaved(alert)))
  return alerts
})
