import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "./Api"
import { CredentialStore } from "./CredentialStore"
import { type Credentials, type Crn, WrongPin } from "./domain"
import { listSubscriptions, signIn, signOut, subscribe, unsubscribe } from "./workflows"

// The workflows run here with a fake Api and the real CredentialStore (on
// WXT's in-memory `browser`). `Layer.mock` builds a service from just the
// functions a test needs; calling any other function fails the test.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }

const withFakeApi = (fakeApi: Layer.PartialEffectful<Api["Service"]>) =>
  Effect.provide(Layer.mergeAll(Layer.mock(Api, fakeApi), CredentialStore.layer))

/** What is saved in the browser right now. */
const saved = Effect.gen(function*() {
  const store = yield* CredentialStore
  return yield* store.get
})

beforeEach(() => {
  fakeBrowser.reset()
})

describe("signIn", () => {
  it.effect("saves the credentials once the server accepts them", () =>
    Effect.gen(function*() {
      const outcome = yield* signIn(credentials)
      assert.strictEqual(outcome, "accountCreated")
      assert.deepStrictEqual(yield* saved, Option.some(credentials))
    }).pipe(withFakeApi({ signIn: () => Effect.succeed("accountCreated") })))

  it.effect("saves nothing when the server rejects them", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(signIn(credentials))
      assert.strictEqual(error._tag, "WrongPin")
      assert.deepStrictEqual(yield* saved, Option.none())
    }).pipe(withFakeApi({ signIn: () => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })) })))
})

describe("signOut", () => {
  it.effect("forgets the saved credentials", () =>
    Effect.gen(function*() {
      yield* signIn(credentials)
      yield* signOut
      assert.deepStrictEqual(yield* saved, Option.none())
    }).pipe(withFakeApi({ signIn: () => Effect.succeed("loggedIn") })))
})

describe("subscribe, unsubscribe and listSubscriptions", () => {
  it.effect("fail with NotSignedIn, without calling the server, when nothing is saved", () =>
    Effect.gen(function*() {
      assert.strictEqual((yield* Effect.flip(subscribe("39835")))._tag, "NotSignedIn")
      assert.strictEqual((yield* Effect.flip(unsubscribe("39835")))._tag, "NotSignedIn")
      assert.strictEqual((yield* Effect.flip(listSubscriptions))._tag, "NotSignedIn")
      // An empty fake: any call to the server would have failed this test.
    }).pipe(withFakeApi({})))

  it.effect("send the saved credentials", () => {
    const calls: Array<{ readonly name: string; readonly crn?: Crn; readonly credentials: Credentials }> = []
    return Effect.gen(function*() {
      yield* Effect.promise(() => fakeBrowser.storage.local.set(credentials))

      yield* subscribe("39835")
      yield* unsubscribe("37429")
      const subscriptions = yield* listSubscriptions

      assert.deepStrictEqual(subscriptions, [{ crn: "39835", name: "INTRO TO DEEP LEARNING" }])
      assert.deepStrictEqual(calls, [
        { name: "subscribe", crn: "39835", credentials },
        { name: "unsubscribe", crn: "37429", credentials },
        { name: "listSubscriptions", credentials }
      ])
    }).pipe(withFakeApi({
      subscribe: (crn, credentials) => Effect.sync(() => void calls.push({ name: "subscribe", crn, credentials })),
      unsubscribe: (crn, credentials) => Effect.sync(() => void calls.push({ name: "unsubscribe", crn, credentials })),
      listSubscriptions: (credentials) =>
        Effect.sync(() => {
          calls.push({ name: "listSubscriptions", credentials })
          return [{ crn: "39835", name: "INTRO TO DEEP LEARNING" }]
        })
    }))
  })
})
