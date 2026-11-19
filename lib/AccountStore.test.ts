import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Stream } from "effect"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { type Account, AccountStore } from "./AccountStore"

// In tests, WXT swaps the extension API for `fakeBrowser`, an in-memory copy
// of it (see vitest.config.ts). So this exercises the real AccountStore
// against a fake `chrome.storage`.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }
const other = { email: "other@oregonstate.edu", pin: "4321" }

/** Run an effect that uses the store. */
const withStore = <A, E, R>(effect: Effect.Effect<A, E, R | AccountStore>) =>
  effect.pipe(Effect.provide(AccountStore.layer))

/** Put something straight into storage, the way another part of the extension would. */
const setRaw = (items: Record<string, unknown>) => Effect.promise(() => fakeBrowser.storage.local.set(items))
const raw = Effect.promise(() => fakeBrowser.storage.local.get())

/** The saved account with its watch list sorted (storage keeps no order). */
const account = Effect.gen(function*() {
  const store = yield* AccountStore
  return Option.map(yield* store.get, (saved) => ({ ...saved, watching: [...saved.watching].sort() }))
})

beforeEach(() => {
  fakeBrowser.reset()
})

describe("get", () => {
  it.effect("is none when nothing is saved", () =>
    withStore(Effect.gen(function*() {
      assert.deepStrictEqual(yield* account, Option.none())
    })))

  it.effect("reads what version 1 of the extension saved (keys `email` and `pin`), watching nothing yet", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ email: "old@oregonstate.edu", pin: "0420" })
      assert.deepStrictEqual(
        yield* account,
        Option.some({ credentials: { email: "old@oregonstate.edu", pin: "0420" }, watching: [] })
      )
    })))

  it.effect("reads the watched classes of the signed-in account, and of no other", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({
        ...credentials,
        "watch:student@oregonstate.edu:33940": true,
        "watch:student@oregonstate.edu:53476": true,
        "watch:other@oregonstate.edu:39835": true
      })
      assert.deepStrictEqual(yield* account, Option.some({ credentials, watching: ["33940", "53476"] }))
    })))

  it.effect("skips a watch key that does not end in a CRN, and the list an unreleased build saved", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({
        ...credentials,
        "watch:student@oregonstate.edu:33940": true,
        "watch:student@oregonstate.edu:": true,
        "watch:student@oregonstate.edu:abc": true,
        // An email that merely starts the same is another account.
        "watch:student@oregonstate.edu:x@y.edu:53476": true,
        watching: ["39835"]
      })
      assert.deepStrictEqual(yield* account, Option.some({ credentials, watching: ["33940"] }))
    })))

  const unusable: ReadonlyArray<{ readonly title: string; readonly saved: Record<string, unknown> }> = [
    { title: "only an email", saved: { email: "student@oregonstate.edu" } },
    { title: "only a PIN", saved: { pin: "1234" } },
    { title: "a PIN that is not 4 digits", saved: { email: "student@oregonstate.edu", pin: "12" } },
    { title: "a PIN saved as a number", saved: { email: "student@oregonstate.edu", pin: 1234 } },
    { title: "an email without @", saved: { email: "student", pin: "1234" } },
    { title: "watched classes but no credentials", saved: { "watch:student@oregonstate.edu:33940": true } }
  ]

  it.effect.each(unusable
  )("is none when the saved data is unusable ($title)", ({ saved }) =>
    withStore(Effect.gen(function*() {
      yield* setRaw(saved)
      assert.deepStrictEqual(yield* account, Option.none())
    })))
})

describe("save", () => {
  it.effect("stores the email and PIN under the keys `email` and `pin`, and nothing else", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      assert.deepStrictEqual(yield* raw, { email: "student@oregonstate.edu", pin: "1234" })
    })))

  it.effect("keeps the watch list when the same email signs in again (a new PIN)", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940"])
      yield* store.save({ email: credentials.email, pin: "5678" })
      assert.deepStrictEqual(
        yield* account,
        Option.some({ credentials: { email: credentials.email, pin: "5678" }, watching: ["33940"] })
      )
    })))

  it.effect("another account sees none of the first one's classes, which are still there when the first comes back", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940"])

      yield* store.save(other)
      assert.deepStrictEqual(yield* account, Option.some({ credentials: other, watching: [] }))

      yield* store.save(credentials)
      assert.deepStrictEqual(yield* account, Option.some({ credentials, watching: ["33940"] }))
    })))
})

describe("clear", () => {
  it.effect("leaves nothing in storage: no credentials, and no watched class of any account", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940"])
      yield* store.watch(other.email, ["39835"])
      // What an unreleased build of version 2 saved.
      yield* setRaw({ watching: ["33940"] })

      yield* store.clear

      assert.deepStrictEqual(yield* raw, {})
      assert.deepStrictEqual(yield* account, Option.none())
    })))
})

describe("watch and unwatch", () => {
  it.effect("save one key per class, named after the account and the CRN", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940", "53476"])
      yield* store.unwatch(credentials.email, ["33940"])
      assert.deepStrictEqual(yield* raw, { ...credentials, "watch:student@oregonstate.edu:53476": true })
    })))

  it.effect("change nothing when asked again, or for a class that is not there", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940"])
      yield* store.watch(credentials.email, ["33940"])
      yield* store.unwatch(credentials.email, ["53476"])
      yield* store.watch(credentials.email, [])
      yield* store.unwatch(credentials.email, [])
      assert.deepStrictEqual(yield* account, Option.some({ credentials, watching: ["33940"] }))
    })))

  it.effect("write for the account they are given, whoever is signed in", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(other)
      yield* store.watch(credentials.email, ["33940"])
      assert.deepStrictEqual(yield* account, Option.some({ credentials: other, watching: [] }))
    })))

  it.effect("do not lose a change when several are made at the same moment", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(credentials)
      yield* store.watch(credentials.email, ["33940", "53476"])

      // The popup stops two alerts while a class page starts a third.
      yield* Effect.all([
        store.unwatch(credentials.email, ["33940"]),
        store.unwatch(credentials.email, ["53476"]),
        store.watch(credentials.email, ["39835"])
      ], { concurrency: "unbounded" })

      assert.deepStrictEqual(yield* account, Option.some({ credentials, watching: ["39835"] }))
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

  it.effect("emits again after save, watch, unwatch and clear", () =>
    withStore(Effect.gen(function*() {
      const { seen, store } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      yield* store.save(credentials)
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))

      yield* store.watch(credentials.email, ["33940"])
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: ["33940"] }))

      yield* store.unwatch(credentials.email, ["33940"])
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some({ credentials, watching: [] }))

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
