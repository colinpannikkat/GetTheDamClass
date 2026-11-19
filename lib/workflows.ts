/**
 * The things a user can do, built from the two services. The popup and the
 * class page call these instead of the services, so both behave the same.
 *
 * Every workflow that hears from the server also brings the saved list of
 * watched classes (`Account.watching`) up to date. That list is what the
 * "Notify me" control on the class page shows. It is always saved for the
 * account the request was sent as: by the time the server answers, someone
 * else may have signed in.
 *
 * In the types below, the third parameter of `Effect<A, E, R>` lists the
 * services a workflow needs. The runtime in `lib/runtime.ts` supplies them.
 */
import { Effect, Option } from "effect"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"
import { type Credentials, type Crn, NotSignedIn } from "./domain"

/** The saved account, or a `NotSignedIn` error when there is none. */
const savedAccount = Effect.gen(function*() {
  const store = yield* AccountStore
  const saved = yield* store.get
  if (Option.isNone(saved)) {
    return yield* new NotSignedIn()
  }
  return saved.value
})

/**
 * Check the email and PIN with the server (creating the account if the email
 * is new) and, if they are accepted, save them in this browser.
 */
export const signIn = Effect.fn("signIn")(function*(credentials: Credentials) {
  const api = yield* Api
  const store = yield* AccountStore
  yield* api.signIn(credentials)
  yield* store.save(credentials)
})

/** Forget everything saved in this browser. The account and its alerts stay on the server. */
export const signOut = Effect.gen(function*() {
  const store = yield* AccountStore
  yield* store.clear
})

/** Start vacancy alerts for a class, as the signed-in user. */
export const subscribe = Effect.fn("subscribe")(function*(crn: Crn) {
  const api = yield* Api
  const store = yield* AccountStore
  const { credentials } = yield* savedAccount
  yield* api.subscribe(crn, credentials).pipe(
    // Already subscribed is what the user wanted: carry on as if it had worked.
    Effect.catchTag("AlreadySubscribed", () => Effect.void)
  )
  yield* store.watch(credentials.email, [crn])
})

/** Stop vacancy alerts for a class, as the signed-in user. */
export const unsubscribe = Effect.fn("unsubscribe")(function*(crn: Crn) {
  const api = yield* Api
  const store = yield* AccountStore
  const { credentials } = yield* savedAccount
  yield* api.unsubscribe(crn, credentials).pipe(
    // Not subscribed means the alerts were already stopped somewhere else
    // (another browser, or the link in an email). Also what the user wanted.
    Effect.catchTag("NotSubscribed", () => Effect.void)
  )
  yield* store.unwatch(credentials.email, [crn])
})

/** Every class the signed-in user gets alerts for. */
export const listSubscriptions = Effect.gen(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const { credentials, watching } = yield* savedAccount
  const subscriptions = yield* api.listSubscriptions(credentials)
  // The server's list is the truth. Drop what we had saved before asking and
  // the server no longer lists, and save everything it does list.
  const listed = subscriptions.map((subscription) => subscription.crn)
  yield* store.unwatch(credentials.email, watching.filter((crn) => !listed.includes(crn)))
  yield* store.watch(credentials.email, listed)
  return subscriptions
})
