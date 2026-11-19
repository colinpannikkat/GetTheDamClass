import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Fiber, Latch, Layer, Option } from "effect"
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
const other = { email: "other@oregonstate.edu", pin: "4321" }

const withFakeApi = (fakeApi: Layer.PartialEffectful<Api["Service"]>) =>
  Effect.provide(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))

/** What is saved in the browser right now. */
const saved = Effect.gen(function*() {
  const store = yield* AccountStore
  return yield* store.get
})

/** The classes saved as watched by whoever is signed in now, sorted (storage keeps no order). */
const watching = Effect.map(saved, (account) => [...Option.getOrThrow(account).watching].sort())

/** As if this user signed in earlier and already watches these classes. */
const signedInWatching = (...crns: ReadonlyArray<Crn>) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    yield* store.save(credentials)
    yield* store.watch(credentials.email, crns)
  })

/** As if someone else signs in on this browser (in the popup, say). */
const signedInAs = (someone: Credentials) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    yield* store.save(someone)
  })

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

      yield* signIn(other)
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ signIn: () => Effect.void })))
})

describe("signOut", () => {
  it.effect("leaves nothing saved: no credentials, and no watched class of any account", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940")
      yield* signedInAs(other)
      yield* subscribe("53476")
      yield* signOut
      assert.deepStrictEqual(yield* saved, Option.none())
      assert.deepStrictEqual(yield* Effect.promise(() => fakeBrowser.storage.local.get()), {})
    }).pipe(withFakeApi({ subscribe: () => Effect.void })))
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
      assert.deepStrictEqual(yield* watching, ["39835", "53476"])
    }).pipe(withFakeApi({
      listSubscriptions: () =>
        Effect.succeed([{ crn: "53476", name: "INTRODUCTION TO COMPUTER SCIENCE I" }, { crn: "39835", name: null }])
    })))

  it.effect("listSubscriptions empties the list when the server lists nothing", () =>
    Effect.gen(function*() {
      yield* signedInWatching("33940", "53476")
      yield* listSubscriptions
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ listSubscriptions: () => Effect.succeed([]) })))
})

// The server can take seconds to answer, and the popup, every open class page
// and every sign-in frame work on the same storage at once. In these tests the
// fake server holds its answer back until the test lets it go.
describe("while the server is still answering", () => {
  /** A fake call that says when it was asked, then waits to be let go. */
  const heldBack = (asked: Latch.Latch, letGo: Latch.Latch) => Effect.andThen(Latch.open(asked), Latch.await(letGo))

  it.effect("subscribe: another account signs in; the class is saved for the account that asked", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching()
      const pending = yield* Effect.forkChild(subscribe("33940"))
      yield* Latch.await(asked)

      yield* signedInAs(other)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      // The other account does not watch a class it never asked for...
      assert.deepStrictEqual(yield* watching, [])
      // ...and the one that asked finds it when it signs in again.
      yield* signedInAs(credentials)
      assert.deepStrictEqual(yield* watching, ["33940"])
    }).pipe(withFakeApi({ subscribe: () => heldBack(asked, letGo) }))
  })

  it.effect("listSubscriptions: another account signs in; the list is saved for the account that asked", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching("33940")
      const pending = yield* Effect.forkChild(listSubscriptions)
      yield* Latch.await(asked)

      yield* signedInAs(other)
      yield* subscribe("12345")
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      assert.deepStrictEqual(yield* watching, ["12345"])
      yield* signedInAs(credentials)
      assert.deepStrictEqual(yield* watching, ["53476"])
    }).pipe(withFakeApi({
      subscribe: () => Effect.void,
      listSubscriptions: () => Effect.as(heldBack(asked, letGo), [{ crn: "53476", name: null }])
    }))
  })

  it.effect("two alerts stopped and one started at the same moment: none of the three is lost", () => {
    const allAsked = Latch.makeUnsafe()
    let calls = 0
    // Every call waits until the server has all three, so they all finish together.
    const held = Effect.suspend(() => Effect.andThen(++calls === 3 ? Latch.open(allAsked) : Effect.void, Latch.await(allAsked)))
    return Effect.gen(function*() {
      yield* signedInWatching("33940", "53476")

      yield* Effect.all([unsubscribe("33940"), unsubscribe("53476"), subscribe("39835")], { concurrency: "unbounded" })

      assert.deepStrictEqual(yield* watching, ["39835"])
    }).pipe(withFakeApi({ subscribe: () => held, unsubscribe: () => held }))
  })

  it.effect("listSubscriptions: a class subscribed to in the meantime stays saved", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching("33940", "53476")
      // The popup opens and asks for the list...
      const pending = yield* Effect.forkChild(listSubscriptions)
      yield* Latch.await(asked)

      // ...and before the answer is back, a class page starts another alert.
      yield* subscribe("39835")
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      // 33940 was saved before and is not on the server's list: gone. 39835
      // is not on that (older) list either, but was not saved before: kept.
      assert.deepStrictEqual(yield* watching, ["39835", "53476"])
    }).pipe(withFakeApi({
      subscribe: () => Effect.void,
      listSubscriptions: () => Effect.as(heldBack(asked, letGo), [{ crn: "53476", name: null }])
    }))
  })
})
