/**
 * The things a user can do, built from the two services. The popup and the
 * class page call these instead of the services, so both behave the same.
 *
 * Every workflow that hears from the server also brings the saved list of
 * watched classes (`Account.watching`) up to date. That list is what the
 * "Notify me" control on the class page shows, so the two never disagree.
 *
 * In the types below, the third parameter of `Effect<A, E, R>` lists the
 * services a workflow needs. The runtime in `lib/runtime.ts` supplies them.
 */
import { Effect, Option } from "effect"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"
import { type Credentials, type Crn, NotSignedIn } from "./domain"

/** The saved credentials, or a `NotSignedIn` error when there are none. */
const savedCredentials = Effect.gen(function*() {
  const store = yield* AccountStore
  const saved = yield* store.get
  if (Option.isNone(saved)) {
    return yield* new NotSignedIn()
  }
  return saved.value.credentials
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

/** Forget the saved account. The account and its alerts stay on the server. */
export const signOut = Effect.gen(function*() {
  const store = yield* AccountStore
  yield* store.clear
})

/** Start vacancy alerts for a class, as the signed-in user. */
export const subscribe = Effect.fn("subscribe")(function*(crn: Crn) {
  const api = yield* Api
  const store = yield* AccountStore
  const credentials = yield* savedCredentials
  yield* api.subscribe(crn, credentials).pipe(
    // Already subscribed is what the user wanted: carry on as if it had worked.
    Effect.catchTag("AlreadySubscribed", () => Effect.void)
  )
  yield* store.updateWatching((watching) => [...watching.filter((watched) => watched !== crn), crn])
})

/** Stop vacancy alerts for a class, as the signed-in user. */
export const unsubscribe = Effect.fn("unsubscribe")(function*(crn: Crn) {
  const api = yield* Api
  const store = yield* AccountStore
  const credentials = yield* savedCredentials
  yield* api.unsubscribe(crn, credentials).pipe(
    // Not subscribed means the alerts were already stopped somewhere else
    // (another browser, or the link in an email). Also what the user wanted.
    Effect.catchTag("NotSubscribed", () => Effect.void)
  )
  yield* store.updateWatching((watching) => watching.filter((watched) => watched !== crn))
})

/** Every class the signed-in user gets alerts for. */
export const listSubscriptions = Effect.gen(function*() {
  const api = yield* Api
  const store = yield* AccountStore
  const credentials = yield* savedCredentials
  const subscriptions = yield* api.listSubscriptions(credentials)
  // The server's list is the truth: replace our copy with it.
  yield* store.updateWatching(() => subscriptions.map((subscription) => subscription.crn))
  return subscriptions
})
