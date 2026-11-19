import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Stream } from "effect"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { type Account, AccountStore } from "./AccountStore"

// In tests, WXT swaps the extension API for `fakeBrowser`, an in-memory copy
// of it (see vitest.config.ts). So this exercises the real AccountStore
// against a fake `chrome.storage`.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }

/** Run an effect that uses the store. */
const withStore = <A, E, R>(effect: Effect.Effect<A, E, R | AccountStore>) =>
  effect.pipe(Effect.provide(AccountStore.layer))

/** Put something straight into storage, the way another part of the extension would. */
const setRaw = (items: Record<string, unknown>) => Effect.promise(() => fakeBrowser.storage.local.set(items))
const raw = Effect.promise(() => fakeBrowser.storage.local.get())

beforeEach(() => {
  fakeBrowser.reset()
})

describe("get", () => {
  it.effect("is none when nothing is saved", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      assert.deepStrictEqual(yield* store.get, Option.none())
    })))

  it.effect("reads what version 1 of the extension saved (keys `email` and `pin`), watching nothing yet", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ email: "old@oregonstate.edu", pin: "0420" })
      const store = yield* AccountStore
      assert.deepStrictEqual(
        yield* store.get,
        Option.some({ credentials: { email: "old@oregonstate.edu", pin: "0420" }, watching: [] })
      )
    })))

  it.effect("reads the watched classes", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940", "53476"] })
      const store = yield* AccountStore
      assert.deepStrictEqual(yield* store.get, Option.some({ credentials, watching: ["33940", "53476"] }))
    })))

  it.effect("treats a watch list that is not a list of CRNs as empty", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940", 53476] })
      const store = yield* AccountStore
      assert.deepStrictEqual(yield* store.get, Option.some({ credentials, watching: [] }))
    })))

  const unusable: ReadonlyArray<{ readonly title: string; readonly saved: Record<string, unknown> }> = [
    { title: "only an email", saved: { email: "student@oregonstate.edu" } },
    { title: "only a PIN", saved: { pin: "1234" } },
    { title: "a PIN that is not 4 digits", saved: { email: "student@oregonstate.edu", pin: "12" } },
    { title: "a PIN saved as a number", saved: { email: "student@oregonstate.edu", pin: 1234 } },
    { title: "an email without @", saved: { email: "student", pin: "1234" } },
    { title: "a watch list but no credentials", saved: { watching: ["33940"] } }
  ]

  it.effect.each(unusable
  )("is none when the saved data is unusable ($title)", ({ saved }) =>
    withStore(Effect.gen(function*() {
      yield* setRaw(saved)
      const store = yield* AccountStore
      assert.deepStrictEqual(yield* store.get, Option.none())
    })))
})

describe("save", () => {
  it.effect("stores the email and PIN under the keys `email` and `pin`, with an empty watch list", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      assert.deepStrictEqual(yield* raw, { email: "student@oregonstate.edu", pin: "1234", watching: [] })
    })))

  it.effect("keeps the watch list when the same email signs in again (a new PIN)", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940"] })
      const store = yield* AccountStore
      yield* store.save({ email: credentials.email, pin: "5678" })
      assert.deepStrictEqual(
        yield* store.get,
        Option.some({ credentials: { email: credentials.email, pin: "5678" }, watching: ["33940"] })
      )
    })))

  it.effect("empties the watch list when another account signs in", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940"] })
      const store = yield* AccountStore
      const other = { email: "other@oregonstate.edu", pin: "1234" }
      yield* store.save(other)
      assert.deepStrictEqual(yield* store.get, Option.some({ credentials: other, watching: [] }))
    })))
})

describe("clear", () => {
  it.effect("removes the credentials and the watch list, and nothing else", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940"], somethingElse: true })
      const store = yield* AccountStore
      yield* store.clear
      assert.deepStrictEqual(yield* store.get, Option.none())
      assert.deepStrictEqual(yield* raw, { somethingElse: true })
    })))
})

describe("updateWatching", () => {
  it.effect("replaces the list with what `update` returns", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ ...credentials, watching: ["33940"] })
      const store = yield* AccountStore
      yield* store.updateWatching((watching) => [...watching, "53476"])
      assert.deepStrictEqual(yield* store.get, Option.some({ credentials, watching: ["33940", "53476"] }))
    })))

  it.effect("does nothing when nobody is signed in", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.updateWatching(() => ["33940"])
      assert.deepStrictEqual(yield* raw, {})
    })))
})

describe("changes", () => {
  /**
   * Follow `changes` in the background and collect what it emits in a queue,
   * so a test can wait for "the next value" with `Queue.take`.
   */
  const startFollowing = Effect.gen(function*() {
    const store = yield* AccountStore
    const seen = yield* Queue.unbounded<Option.Option<Account>>()
    // `forkScoped`: run in the background until the test ends.
    yield* Effect.forkScoped(Stream.runForEach(store.changes, (value) => Queue.offer(seen, value)))
    return { store, seen }
  })

  it.effect("starts with the current value", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw(credentials)
      const { seen } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))
    })))

  it.effect("emits again after save, updateWatching and clear", () =>
    withStore(Effect.gen(function*() {
      const { seen, store } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      yield* store.save(credentials)
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))

      yield* store.updateWatching(() => ["33940"])
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: ["33940"] }))

      yield* store.clear
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())
    })))

  it.effect("sees a change made by another part of the extension", () =>
    withStore(Effect.gen(function*() {
      const { seen } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      // Not through this store: what a sign-in in the popup, or in the
      // sign-in frame, looks like from the "Notify me" control.
      yield* setRaw(credentials)
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))
    })))

  it.effect("ignores changes to other storage keys", () =>
    withStore(Effect.gen(function*() {
      const { seen, store } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      yield* setRaw({ somethingElse: true })
      yield* store.save(credentials)
      // The next value is the save. The unrelated change produced nothing.
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))
    })))

  it.effect("stops listening when nobody follows any more", () =>
    Effect.gen(function*() {
      // `Effect.scoped` ends the background follower when the block finishes.
      yield* Effect.scoped(withStore(Effect.gen(function*() {
        const { seen } = yield* startFollowing
        yield* Queue.take(seen)
        assert.isTrue(fakeBrowser.storage.local.onChanged.hasListeners())
      })))
      assert.isFalse(fakeBrowser.storage.local.onChanged.hasListeners())
    }))
})
