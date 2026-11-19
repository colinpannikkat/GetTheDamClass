/**
 * The things a user can do, built from the two services. The popup, the
 * class page and the sign-in frame call these instead of the services, so they
 * all behave the same.
 *
 * Every workflow that hears from the server also brings the saved list of
 * watched classes (`Account.watching`) up to date. That list is what the
 * "Notify me" control on the class page shows. It is always saved for the
 * account the request was sent as: by the time the server answers, someone
 * else may have signed in.
 *
 * Every call made with the saved sign-in token can come back `NotSignedIn`:
 * the server no longer knows the token (the account was deleted from another
 * browser, or the token went unused for a year). The token is then forgotten,
 * so this browser is signed out everywhere in the extension instead of being
 * left with buttons that keep failing. The email stays, for the sign-in form.
 *
 * In the types below, the third parameter of `Effect<A, E, R>` lists the
 * services a workflow needs. The runtime in `lib/runtime.ts` supplies them.
 */
import { type EmailAddress, NotSignedIn, type SignInCode } from "@getthedamclass/shared/domain"
import { Effect } from "effect"
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
 * Email a sign-in code to this address, and remember that it was sent, so
 * the sign-in form can wait at the code step even if it is closed meanwhile.
 *
 * When the server says a code went to this address less than a minute ago,
 * that is remembered too, and the error still reaches the form: either way
 * there is a code in the inbox, and the code step is where it can be typed.
 */
export const requestCode = Effect.fn("requestCode")(function*(email: EmailAddress) {
  const api = yield* Api
  const store = yield* AccountStore
  yield* api.sendCode(email).pipe(Effect.tapErrorTag("CodeRecentlySent", () => store.saveCodeRequest(email)))
  yield* store.saveCodeRequest(email)
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
export const changeEmail = Effect.gen(function*() {
  const store = yield* AccountStore
  yield* store.forgetCodeRequest
})

/**
 * End this browser's token on the server, then forget everything saved in
 * this browser. The account and its alerts stay on the server. If the server
 * cannot be reached, the browser forgets all the same: the token then ends by
 * itself once it has gone unused for a year.
 */
export const signOut = Effect.gen(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const saved = yield* store.get
  if (saved.status === "signedIn") {
    yield* Effect.ignore(api.signOut(saved.token))
  }
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
export const listAlerts = Effect.gen(function*() {
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
