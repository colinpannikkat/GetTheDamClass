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
import { type EmailAddress, NotSignedIn, type SignInCode } from "@getthedamclass/shared/domain"
import { Clock, Duration, Effect } from "effect"
import { type Account, AccountStore } from "./AccountStore"
import { Api } from "./Api"
import { type ClassId, sameClass } from "./domain"

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
 * Email a sign-in code to this address, and remember that it was asked for,
 * so the sign-in form shows the step where the code is typed.
 *
 * It is remembered before the server is asked, not after. The browser closes
 * the popup as soon as the student switches to their inbox, which is exactly
 * when they do, often before the answer is back; and closing the popup ends
 * everything running in it. Saved first, the form opens again at the code
 * step.
 *
 * If the server refuses or cannot be reached, the request saved before this
 * one is put back (none, at the email step; at the code step, the code that
 * was really sent, so its 15 minutes are not counted from this attempt). If
 * the popup was closed by then, that never happens: the student comes back to
 * the code step, and no email is coming. "Send a new code" there asks again
 * and shows why it did not work.
 *
 * "A code went to this address less than a minute ago" is the one refusal
 * after which the form stays at the code step: that code may be in the
 * inbox. It may also be used already (someone signed in, out and in again
 * within the minute), so the form shows the server's sentence there.
 */
export const requestCode = Effect.fn("requestCode")(function*(email: EmailAddress) {
  const api = yield* Api
  const store = yield* AccountStore
  const { codeRequest: earlier } = yield* store.get
  yield* store.saveCodeRequest({ email, sentAt: yield* Clock.currentTimeMillis })
  yield* api.sendCode(email).pipe(Effect.tapError((error) => {
    if (error._tag === "CodeRecentlySent" && earlier?.email !== email) {
      // Nothing was saved for this address: keep the request just saved,
      // as the best guess of when that code went out (within the minute).
      return Effect.void
    }
    return earlier === undefined ? store.forgetCodeRequest : store.saveCodeRequest(earlier)
  }))
})

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
