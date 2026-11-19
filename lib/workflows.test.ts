import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"
import {
  AlreadySubscribed,
  ClassNotFound,
  type Credentials,
  type Crn,
  NetworkError,
  NotSubscribed,
  WrongPin
} from "./domain"
import { listSubscriptions, signIn, signOut, subscribe, unsubscribe } from "./workflows"

// The workflows run here with a fake Api and the real AccountStore (on WXT's
// in-memory `browser`). `Layer.mock` builds a service from just the functions
// a test needs; calling any other function fails the test.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }

const withFakeApi = (fakeApi: Layer.PartialEffectful<Api["Service"]>) =>
  Effect.provide(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))

/** What is saved in the browser right now. */
const saved = Effect.gen(function*() {
  const store = yield* AccountStore
  return yield* store.get
})

/** The saved list of watched classes. */
const watching = Effect.map(saved, (account) => Option.getOrThrow(account).watching)

/** As if this user signed in earlier and already watches these classes. */
const signedInWatching = (...crns: ReadonlyArray<Crn>) =>
  Effect.promise(() => fakeBrowser.storage.local.set({ ...credentials, watching: crns }))

beforeEach(() => {
  fakeBrowser.reset()
})

describe("signIn", () => {
  it.effect("saves the credentials once the server accepts them", () =>
    Effect.gen(function*() {
      yield* signIn(credentials)
      assert.deepStrictEqual(yield* saved, Option.some({ credentials, watching: [] }))
    }).pipe(withFakeApi({ signIn: () => Effect.void })))

  it.effect("saves nothing when the server rejects them", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(signIn(credentials))
      assert.strictEqual(error._tag, "WrongPin")
      assert.deepStrictEqual(yield* saved, Option.none())
    }).pipe(withFakeApi({ signIn: () => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })) })))

  it.effect("another account starts with an empty watch list; the same one keeps its list", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")

      yield* signIn({ email: credentials.email, pin: "5678" })
      assert.deepStrictEqual(yield* watching, ["33940"])

      yield* signIn({ email: "other@oregonstate.edu", pin: "1234" })
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ signIn: () => Effect.void })))
})

describe("signOut", () => {
  it.effect("forgets the saved credentials and the watch list", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      yield* signOut
      assert.deepStrictEqual(yield* saved, Option.none())
      assert.deepStrictEqual(yield* Effect.promise(() => fakeBrowser.storage.local.get()), {})
    }).pipe(withFakeApi({})))
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
      yield* signedInWatching()

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

describe("the saved watch list follows what the server says", () => {
  it.effect("subscribe adds the class, once", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      yield* subscribe("53476")
      yield* subscribe("53476")
      assert.deepStrictEqual(yield* watching, ["33940", "53476"])
    }).pipe(withFakeApi({ subscribe: () => Effect.void })))

  it.effect("subscribe succeeds, and adds the class, when the server says it was subscribed already", () =>
    Effect.gen(function*() {
      yield* signedInWatching()
      yield* subscribe("53476")
      assert.deepStrictEqual(yield* watching, ["53476"])
    }).pipe(withFakeApi({ subscribe: (crn) => Effect.fail(new AlreadySubscribed({ crn })) })))

  it.effect("a failed subscribe leaves the list alone", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      assert.strictEqual((yield* Effect.flip(subscribe("53476")))._tag, "NetworkError")
      assert.deepStrictEqual(yield* watching, ["33940"])
    }).pipe(withFakeApi({ subscribe: () => Effect.fail(new NetworkError({ cause: "offline" })) })))

  it.effect("unsubscribe removes the class", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940", "53476")
      yield* unsubscribe("33940")
      assert.deepStrictEqual(yield* watching, ["53476"])
    }).pipe(withFakeApi({ unsubscribe: () => Effect.void })))

  it.effect("unsubscribe succeeds, and removes the class, when the server says it was not subscribed", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      yield* unsubscribe("33940")
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ unsubscribe: (crn) => Effect.fail(new NotSubscribed({ crn })) })))

  it.effect("a failed unsubscribe leaves the list alone", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      assert.strictEqual((yield* Effect.flip(unsubscribe("33940")))._tag, "ClassNotFound")
      assert.deepStrictEqual(yield* watching, ["33940"])
    }).pipe(withFakeApi({ unsubscribe: (crn) => Effect.fail(new ClassNotFound({ crn })) })))

  it.effect("listSubscriptions replaces the list with the server's", () =>
    Effect.gen(function*() {
      // 33940 was stopped somewhere else; 39835 was added somewhere else.
      yield* signedInWatching("33940", "53476")
      yield* listSubscriptions
      assert.deepStrictEqual(yield* watching, ["53476", "39835"])
    }).pipe(withFakeApi({
      listSubscriptions: () =>
        Effect.succeed([{ crn: "53476", name: "INTRODUCTION TO COMPUTER SCIENCE I" }, { crn: "39835", name: null }])
    })))
})
