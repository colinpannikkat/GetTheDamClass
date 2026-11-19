import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Stream } from "effect"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { CredentialStore } from "./CredentialStore"

// In tests, WXT swaps the extension API for `fakeBrowser`, an in-memory copy
// of it (see vitest.config.ts). So this exercises the real CredentialStore
// against a fake `chrome.storage`.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }

/** Run an effect that uses the store. */
const withStore = <A, E, R>(effect: Effect.Effect<A, E, R | CredentialStore>) =>
  effect.pipe(Effect.provide(CredentialStore.layer))

beforeEach(() => {
  fakeBrowser.reset()
})

describe("get", () => {
  it.effect("is none when nothing is saved", () =>
    withStore(Effect.gen(function*() {
      const store = yield* CredentialStore
      assert.deepStrictEqual(yield* store.get, Option.none())
    })))

  it.effect("reads what version 1 of the extension saved (keys `email` and `pin`)", () =>
    withStore(Effect.gen(function*() {
      yield* Effect.promise(() => fakeBrowser.storage.local.set({ email: "old@oregonstate.edu", pin: "0420" }))
      const store = yield* CredentialStore
      assert.deepStrictEqual(yield* store.get, Option.some({ email: "old@oregonstate.edu", pin: "0420" }))
    })))

  const unusable: ReadonlyArray<{ readonly title: string; readonly saved: Record<string, unknown> }> = [
    { title: "only an email", saved: { email: "student@oregonstate.edu" } },
    { title: "only a PIN", saved: { pin: "1234" } },
    { title: "a PIN that is not 4 digits", saved: { email: "student@oregonstate.edu", pin: "12" } },
    { title: "a PIN saved as a number", saved: { email: "student@oregonstate.edu", pin: 1234 } },
    { title: "an email without @", saved: { email: "student", pin: "1234" } }
  ]

  it.effect.each(unusable
  )("is none when the saved data is unusable ($title)", ({ saved }) =>
    withStore(Effect.gen(function*() {
      yield* Effect.promise(() => fakeBrowser.storage.local.set(saved))
      const store = yield* CredentialStore
      assert.deepStrictEqual(yield* store.get, Option.none())
    })))
})

describe("save", () => {
  it.effect("stores the email and PIN under the keys `email` and `pin`", () =>
    withStore(Effect.gen(function*() {
      const store = yield* CredentialStore
      yield* store.save(credentials)
      const raw = yield* Effect.promise(() => fakeBrowser.storage.local.get())
      assert.deepStrictEqual(raw, { email: "student@oregonstate.edu", pin: "1234" })
      assert.deepStrictEqual(yield* store.get, Option.some(credentials))
    })))
})

describe("clear", () => {
  it.effect("removes the credentials and nothing else", () =>
    withStore(Effect.gen(function*() {
      yield* Effect.promise(() => fakeBrowser.storage.local.set({ ...credentials, somethingElse: true }))
      const store = yield* CredentialStore
      yield* store.clear
      assert.deepStrictEqual(yield* store.get, Option.none())
      const raw = yield* Effect.promise(() => fakeBrowser.storage.local.get())
      assert.deepStrictEqual(raw, { somethingElse: true })
    })))
})

describe("watch", () => {
  /**
   * Follow `watch` in the background and collect what it emits in a queue, so
   * a test can wait for "the next value" with `Queue.take`.
   */
  const startWatching = Effect.gen(function*() {
    const store = yield* CredentialStore
    const seen = yield* Queue.unbounded<Option.Option<typeof credentials>>()
    // `forkScoped`: run in the background until the test ends.
    yield* Effect.forkScoped(Stream.runForEach(store.watch, (value) => Queue.offer(seen, value)))
    return { store, seen }
  })

  it.effect("starts with the current value", () =>
    withStore(Effect.gen(function*() {
      yield* Effect.promise(() => fakeBrowser.storage.local.set(credentials))
      const { seen } = yield* startWatching
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some(credentials))
    })))

  it.effect("emits again after save and after clear", () =>
    withStore(Effect.gen(function*() {
      const { seen, store } = yield* startWatching
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      yield* store.save(credentials)
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some(credentials))

      yield* store.clear
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())
    })))

  it.effect("sees a change made by another part of the extension", () =>
    withStore(Effect.gen(function*() {
      const { seen } = yield* startWatching
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      // Not through the store: this is what a sign-in in the popup looks like
      // from the content script.
      yield* Effect.promise(() => fakeBrowser.storage.local.set(credentials))
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some(credentials))
    })))

  it.effect("ignores changes to other storage keys", () =>
    withStore(Effect.gen(function*() {
      const { seen, store } = yield* startWatching
      assert.deepStrictEqual(yield* Queue.take(seen), Option.none())

      yield* Effect.promise(() => fakeBrowser.storage.local.set({ somethingElse: true }))
      yield* store.save(credentials)
      // The next value is the save. The unrelated change produced nothing.
      assert.deepStrictEqual(yield* Queue.take(seen), Option.some(credentials))
    })))

  it.effect("stops listening when nobody watches any more", () =>
    Effect.gen(function*() {
      // `Effect.scoped` ends the background watcher when the block finishes.
      yield* Effect.scoped(withStore(Effect.gen(function*() {
        const { seen } = yield* startWatching
        yield* Queue.take(seen)
        assert.isTrue(fakeBrowser.storage.local.onChanged.hasListeners())
      })))
      assert.isFalse(fakeBrowser.storage.local.onChanged.hasListeners())
    }))
})
