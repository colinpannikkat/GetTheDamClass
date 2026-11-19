/**
 * The things a user can do, built from the two services. The popup and the
 * content script call these instead of the services, so both behave the same.
 *
 * In the types below, the third parameter of `Effect<A, E, R>` lists the
 * services a workflow needs. The runtime in `lib/runtime.ts` supplies them.
 */
import { Effect, Option } from "effect"
import { Api } from "./Api"
import { CredentialStore } from "./CredentialStore"
import { type Credentials, type Crn, NotSignedIn } from "./domain"

/** The saved credentials, or a `NotSignedIn` error when there are none. */
const savedCredentials = Effect.gen(function*() {
  const store = yield* CredentialStore
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
  const store = yield* CredentialStore
  const outcome = yield* api.signIn(credentials)
  yield* store.save(credentials)
  return outcome
})

/** Forget the saved credentials. The account and its alerts stay on the server. */
export const signOut = Effect.gen(function*() {
  const store = yield* CredentialStore
  yield* store.clear
})

/** Start vacancy alerts for a class, as the signed-in user. */
export const subscribe = Effect.fn("subscribe")(function*(crn: Crn) {
  const api = yield* Api
  const credentials = yield* savedCredentials
  yield* api.subscribe(crn, credentials)
})

/** Stop vacancy alerts for a class, as the signed-in user. */
export const unsubscribe = Effect.fn("unsubscribe")(function*(crn: Crn) {
  const api = yield* Api
  const credentials = yield* savedCredentials
  yield* api.unsubscribe(crn, credentials)
})

/** Every class the signed-in user gets alerts for. */
export const listSubscriptions = Effect.gen(function*() {
  const api = yield* Api
  const credentials = yield* savedCredentials
  return yield* api.listSubscriptions(credentials)
})
