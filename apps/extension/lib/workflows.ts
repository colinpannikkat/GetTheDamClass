/**
 * The things a user can do, built from the two services. The popup, the
 * class page and the sign-in frame call these instead of the services, so they
 * all behave the same.
 *
 * The saved list of watched classes (`Account.watching`) is what the "Notify
 * me" control on the class page shows. `subscribe` and `unsubscribe` add or
 * remove the one class they were for, and only `listAlerts`, which the popup
 * runs when it opens, makes the whole list match the server's. So an alert
 * that ended elsewhere (stopped with the link in an email or in another
 * browser, or removed by the server's daily cleanup) still shows as watched
 * until the popup is next opened. Changes are always saved for the account
 * the request was sent as: by the time the server answers, someone else may
 * have signed in.
 *
 * Every call made with the saved sign-in token can come back `NotSignedIn`:
 * the server no longer knows the token (the account was deleted from another
 * browser, or the token went unused for a year). The token and the classes
 * saved as watched by its account are then forgotten (see
 * `AccountStore.forgetToken`), so this browser is signed out everywhere in
 * the extension instead of being left with buttons that keep failing. The
 * email stays, for the sign-in form.
 *
 * In the types below, the third parameter of `Effect<A, E, R>` lists the
 * services a workflow needs. The runtime in `lib/runtime.ts` supplies them.
 */
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

/** The signed-in account, or a `NotSignedIn` error when nobody is signed in. */
const signedInAccount = Effect.gen(function*() {
  const store = yield* AccountStore
  const saved = yield* store.get
  if (saved.status === "signedOut") {
    return yield* new NotSignedIn({ message: "Sign in to get alerts." })
  }
  return saved
})

/** Make a call with the account's token, and forget the token if the server no longer accepts it. */
const withToken = <A, E, R>(account: Account, call: (token: string) => Effect.Effect<A, E | NotSignedIn, R>) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    return yield* call(account.token).pipe(Effect.tapErrorTag("NotSignedIn", () => store.forgetToken(account.token)))
  })

/**
 * `requestCode` brought no new code, because of `reason`, and the sign-in
 * form is now at the code step for `codeStepFor`, or at the email step when
 * that is `undefined`. The form says why there.
 */
export class CodeNotSent extends Data.TaggedError("CodeNotSent")<{
  readonly reason: CodeRecentlySent | EmailNotSent | NetworkError | ServerError
  readonly codeStepFor: EmailAddress | undefined
}> {}

/**
 * `requestCode` brought no new code, but before the answer came the student
 * had moved on: "Use a different email", a code asked for in another part of
 * the extension, a sign-in or a sign-out. What they did stands, and the
 * answer is about a step the form no longer shows, so there is nothing to
 * tell them.
 */
export class CodeRequestOvertaken extends Data.TaggedError("CodeRequestOvertaken")<{}> {}

/**
 * Email a sign-in code to this address, and remember that it was asked for,
 * so the sign-in form shows the step where the code is typed.
 *
 * It is remembered before the server is asked, not after. The browser closes
 * the popup as soon as the student switches to their inbox, which is exactly
 * when they do, often before the answer is back; and closing the popup ends
 * everything running in it. Saved first, the form opens again at the code
 * step. If the popup was closed before a refusal came, the student comes back
 * to a code step for which no email is coming; "Send a new code" there asks
 * again and shows why it did not work.
 *
 * If the server refuses or cannot be reached while the request saved here is
 * still the saved one, it is undone (see `afterRefusal`). If something else
 * replaced or removed it meanwhile, that is left alone
 * (`CodeRequestOvertaken`).
 */
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

/**
 * The code request to keep when the server refused `request`, or could not
 * be reached. `earlier` is the one saved before it, if its code still works.
 */
const afterRefusal = (
  reason: CodeNotSent["reason"],
  request: CodeRequest,
  earlier: CodeRequest | undefined
): CodeRequest | undefined => {
  switch (reason._tag) {
    case "CodeRecentlySent":
      // A code for this address went out less than a minute ago, and it may
      // be in the inbox (or used already: someone signed in, out and in again
      // within the minute). Stay at its code step, with its own time if this
      // browser asked for it; otherwise this request's time is the best guess.
      return earlier?.email === request.email ? earlier : request
    case "EmailNotSent":
      // The server replaced the earlier code with a new one, then forgot the
      // new one when its email failed: no code works for this address now.
      return undefined
    case "NetworkError":
    case "ServerError":
      // Probably nothing changed on the server: the earlier code, if any,
      // still works, for 15 minutes from when it was asked for.
      return earlier
  }
}

/**
 * Trade the emailed code for a sign-in token (the server creates the account
 * if the address is new) and save it in this browser.
 */
export const signIn = Effect.fn("signIn")(function*(email: EmailAddress, code: SignInCode) {
  const api = yield* Api
  const store = yield* AccountStore
  const token = yield* api.signIn(email, code)
  yield* store.save(email, token)
})

/** Go back from the code step to the email step: forget the code that was asked for. */
export const changeEmail = Effect.fn("changeEmail")(function*() {
  const store = yield* AccountStore
  yield* store.forgetCodeRequest
})

/**
 * How long signing out waits for the server to end the token. Short: by then
 * this browser has signed out already, and the wait only delays the note the
 * popup shows afterwards.
 */
const SIGN_OUT_SERVER_LIMIT = Duration.seconds(5)

/**
 * Forget everything saved in this browser, then ask the server to end this
 * browser's token. The account and its alerts stay on the server.
 *
 * Forgetting comes first, so signing out never depends on the server: closing
 * the popup straight after pressing "Sign out" still signs out, and so does a
 * server that is down or never answers. When the server is not told, nothing
 * else changes for the student: nobody holds the token any more, and the
 * server removes it once it has gone unused for a year.
 */
export const signOut = Effect.fn("signOut")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const saved = yield* store.get
  yield* store.clear
  if (saved.status === "signedIn") {
    yield* api.signOut(saved.token).pipe(Effect.timeout(SIGN_OUT_SERVER_LIMIT), Effect.ignore)
  }
})

/**
 * Delete the signed-in account on the server, which ends its alerts and
 * signs it out of every browser, then forget everything saved in this one.
 * Unlike signing out, nothing is forgotten here if the server could not do it.
 */
export const deleteAccount = Effect.fn("deleteAccount")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.deleteAccount(token))
  yield* store.clear
})

/** Start vacancy alerts for a class, as the signed-in user. */
export const subscribe = Effect.fn("subscribe")(function*(classId: ClassId) {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.subscribe(token, classId)).pipe(
    // Already subscribed is what the user wanted: carry on as if it had worked.
    Effect.catchTag("AlreadySubscribed", () => Effect.void)
  )
  yield* store.watch(account.email, [classId])
})

/** Stop vacancy alerts for a class, as the signed-in user. */
export const unsubscribe = Effect.fn("unsubscribe")(function*(classId: ClassId) {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  yield* withToken(account, (token) => api.unsubscribe(token, classId)).pipe(
    // Not subscribed means the alerts were already stopped somewhere else
    // (another browser, or the link in an email). Also what the user wanted.
    Effect.catchTag("NotSubscribed", () => Effect.void)
  )
  yield* store.unwatch(account.email, [classId])
})

/** Every class the signed-in user gets alerts for. */
export const listAlerts = Effect.fn("listAlerts")(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const account = yield* signedInAccount
  const alerts = yield* withToken(account, (token) => api.listAlerts(token))
  // The server's list is the truth, as of when we asked. So only undo the
  // differences from what was saved at that moment: a class started or stopped
  // while the server was answering is newer than its list, and is left alone.
  const isListed = (watched: ClassId) => alerts.some((alert) => sameClass(alert, watched))
  const wasSaved = (alert: ClassId) => account.watching.some((watched) => sameClass(watched, alert))
  yield* store.unwatch(account.email, account.watching.filter((watched) => !isListed(watched)))
  yield* store.watch(account.email, alerts.filter((alert) => !wasSaved(alert)))
  return alerts
})
