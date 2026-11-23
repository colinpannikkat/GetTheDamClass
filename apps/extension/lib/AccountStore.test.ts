import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore, type CodeRequest, type Saved } from "./AccountStore"
import type { ClassId } from "./domain"

// In tests, WXT swaps the extension API for `fakeBrowser`, an in-memory copy
// of it (see vitest.config.ts). So this exercises the real AccountStore
// against a fake `chrome.storage`.
//
// `it.effect` runs on a test clock that starts at 0 (1970), so "now" is 0
// until a test moves it forward.

const email = "student@oregonstate.edu"
const other = "other@oregonstate.edu"
const token = "token-of-this-browser"
const intro = { term: "202702", crn: "33940" }
/** The same CRN in another term: another class. */
const introInFall = { term: "202701", crn: "33940" }
const ethics = { term: "202702", crn: "53476" }

/** Run an effect that uses the store. */
const withStore = <A, E, R>(effect: Effect.Effect<A, E, R | AccountStore>) =>
  effect.pipe(Effect.provide(AccountStore.layer))

/** Put something straight into storage, the way another part of the extension (or an older version) would. */
const setRaw = (items: Record<string, unknown>) => Effect.promise(() => fakeBrowser.storage.local.set(items))
const raw = Effect.promise(() => fakeBrowser.storage.local.get())

/** What is saved, with the watch list sorted (storage keeps no order). */
const saved = Effect.gen(function*() {
  const store = yield* AccountStore
  const value: Saved = yield* store.get
  return value.status === "signedIn"
    ? { ...value, watching: [...value.watching].sort((a, b) => `${a.term}${a.crn}`.localeCompare(`${b.term}${b.crn}`)) }
    : value
}).pipe(Effect.map((value): Saved => value))

/** What `get` gives for `student@...` signed in with `token`. */
const signedIn = (watching: ReadonlyArray<ClassId> = []): Extract<Saved, { status: "signedIn" }> => ({
  status: "signedIn",
  email,
  token,
  watching,
  codeRequest: undefined
})

/** What `get` gives for nobody signed in. */
const signedOut = (fields: { readonly email?: string; readonly codeRequest?: CodeRequest } = {}): Saved => ({
  status: "signedOut",
  email: fields.email,
  codeRequest: fields.codeRequest
})

beforeEach(() => {
  fakeBrowser.reset()
})

describe("get", () => {
  it.effect("is signed out, knowing nothing, when nothing is saved", () =>
    withStore(Effect.gen(function*() {
      assert.deepStrictEqual(yield* saved, signedOut())
    })))

  it.effect("is signed in with an email and a token, watching the classes of that account and of no other", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({
        email,
        token,
        "watch:202702:student@oregonstate.edu:33940": true,
        "watch:202701:student@oregonstate.edu:33940": true,
        "watch:202702:other@oregonstate.edu:53476": true
      })
      assert.deepStrictEqual(yield* saved, signedIn([introInFall, intro]))
    })))

  it.effect("skips a watch key that does not end in a CRN or has no term, and one of an email that merely starts the same", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({
        email,
        token,
        "watch:202702:student@oregonstate.edu:33940": true,
        "watch:202702:student@oregonstate.edu:": true,
        "watch:202702:student@oregonstate.edu:abc": true,
        "watch:student@oregonstate.edu:53476": true,
        "watch:202702:student@oregonstate.edu:x@y.edu:53476": true
      })
      assert.deepStrictEqual(yield* saved, signedIn([intro]))
    })))

  it.effect("is signed out, with the email for the form, when there is an email but no token", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ email, "watch:202702:student@oregonstate.edu:33940": true })
      assert.deepStrictEqual(yield* saved, signedOut({ email }))
    })))

  it.effect.each([
    { title: "only a token", raw: { token }, expected: signedOut() },
    { title: "an empty token", raw: { email, token: "" }, expected: signedOut({ email }) },
    { title: "a token that is not text", raw: { email, token: 42 }, expected: signedOut({ email }) },
    { title: "an email without @", raw: { email: "student", token }, expected: signedOut() }
  ])("is signed out when the saved data is unusable ($title)", ({ raw, expected }) =>
    withStore(Effect.gen(function*() {
      yield* setRaw(raw)
      assert.deepStrictEqual(yield* saved, expected)
    })))

  it.effect("has the code request for 15 minutes after the code was asked for, and then removes it from storage", () =>
    withStore(Effect.gen(function*() {
      const codeRequest = { email: other, requestedAt: 1_000 }
      yield* setRaw({ email, codeRequest })
      yield* TestClock.setTime(1_000 + 15 * 60_000 - 1)
      assert.deepStrictEqual(yield* saved, signedOut({ email, codeRequest }))
      assert.deepStrictEqual(yield* raw, { email, codeRequest })

      yield* TestClock.setTime(1_000 + 15 * 60_000)
      assert.deepStrictEqual(yield* saved, signedOut({ email }))
      assert.deepStrictEqual(yield* raw, { email })
    })))

  it.effect("ignores a code request that is not what this extension saves", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ codeRequest: { email: "student", requestedAt: 0 } })
      assert.deepStrictEqual(yield* saved, signedOut())
    })))
})

describe("updating from a version that signed in with a PIN", () => {
  it.effect("removes the PIN and the old server's watched classes, keeps the email, and is signed out", () =>
    Effect.gen(function*() {
      // What a version that signed in with a PIN saved, before the store is first used.
      yield* setRaw({
        email,
        pin: "1234",
        "watch:202702:student@oregonstate.edu:33940": true,
        "watch:202702:other@oregonstate.edu:53476": true
      })
      yield* withStore(Effect.gen(function*() {
        assert.deepStrictEqual(yield* raw, { email })
        assert.deepStrictEqual(yield* saved, signedOut({ email }))
      }))
    }))

  it.effect("removes nothing from an install that never had a PIN", () =>
    Effect.gen(function*() {
      const before = { email, token, "watch:202702:student@oregonstate.edu:33940": true }
      yield* setRaw(before)
      yield* withStore(Effect.gen(function*() {
        assert.deepStrictEqual(yield* raw, before)
      }))
    }))
})

describe("save", () => {
  it.effect("stores the email and token under `email` and `token`, and forgets the code request", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.saveCodeRequest({ email, requestedAt: 0 })
      yield* store.save(email, token)
      assert.deepStrictEqual(yield* raw, { email, token })
    })))

  it.effect("keeps the watch list when the same email signs in again (a new token)", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro])
      yield* store.save(email, "a-newer-token")
      assert.deepStrictEqual(yield* saved, { ...signedIn([intro]), token: "a-newer-token" })
    })))

  it.effect("another account sees none of the first one's classes, which are still there when the first comes back", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro])

      yield* store.save(other, "other-token")
      assert.deepStrictEqual(yield* saved, { ...signedIn(), email: other, token: "other-token" })

      yield* store.save(email, token)
      assert.deepStrictEqual(yield* saved, signedIn([intro]))
    })))
})

describe("forgetToken", () => {
  it.effect("signs this browser out, and keeps the email for the form", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.forgetToken(token)
      assert.deepStrictEqual(yield* saved, signedOut({ email }))
    })))

  it.effect("forgets the classes saved as watched by that account, and keeps another account's", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro, introInFall])
      yield* store.watch(other, [ethics])
      yield* store.forgetToken(token)
      assert.deepStrictEqual(yield* raw, { email, "watch:202702:other@oregonstate.edu:53476": true })
    })))

  it.effect("leaves a newer token alone: someone signed in again meanwhile", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, "a-newer-token")
      yield* store.forgetToken(token)
      assert.deepStrictEqual(yield* saved, { ...signedIn(), token: "a-newer-token" })
    })))
})

describe("code requests", () => {
  it.effect("saveCodeRequest remembers the address and when, and forgetCodeRequest forgets it", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* TestClock.setTime(5_000)
      yield* store.saveCodeRequest({ email: other, requestedAt: 5_000 })
      assert.deepStrictEqual(yield* raw, { codeRequest: { email: other, requestedAt: 5_000 } })
      assert.deepStrictEqual(yield* saved, signedOut({ codeRequest: { email: other, requestedAt: 5_000 } }))

      yield* store.forgetCodeRequest
      assert.deepStrictEqual(yield* raw, {})
    })))

  it.effect("replaceCodeRequest replaces or forgets the saved request while it is the expected one", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      const first = { email, requestedAt: 1_000 }
      const second = { email, requestedAt: 2_000 }
      yield* store.saveCodeRequest(second)

      assert.isTrue(yield* store.replaceCodeRequest(second, first))
      assert.deepStrictEqual(yield* raw, { codeRequest: first })

      assert.isTrue(yield* store.replaceCodeRequest(first, undefined))
      assert.deepStrictEqual(yield* raw, {})
    })))

  it.effect.each([
    { title: "another request, at another time", now: { codeRequest: { email, requestedAt: 3_000 } } },
    { title: "another request, for another address", now: { codeRequest: { email: other, requestedAt: 2_000 } } },
    { title: "no request", now: {} }
  ])("replaceCodeRequest leaves it alone when what is saved is $title", ({ now }) =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* setRaw(now)
      assert.isFalse(yield* store.replaceCodeRequest({ email, requestedAt: 2_000 }, { email, requestedAt: 1_000 }))
      assert.deepStrictEqual(yield* raw, now)
    })))
})

describe("clear", () => {
  it.effect("leaves nothing in storage: no sign-in, no code request, and no watched class of any account", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro])
      yield* store.watch(other, [ethics])
      yield* store.saveCodeRequest({ email: other, requestedAt: 0 })

      yield* store.clear

      assert.deepStrictEqual(yield* raw, {})
      assert.deepStrictEqual(yield* saved, signedOut())
    })))
})

describe("watch and unwatch", () => {
  it.effect("save one key per class, named after the term, the account and the CRN", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro, introInFall, ethics])
      yield* store.unwatch(email, [ethics])
      assert.deepStrictEqual(yield* raw, {
        email,
        token,
        "watch:202702:student@oregonstate.edu:33940": true,
        "watch:202701:student@oregonstate.edu:33940": true
      })
    })))

  it.effect("tell the same CRN in two terms apart", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro, introInFall])
      yield* store.unwatch(email, [introInFall])
      assert.deepStrictEqual(yield* saved, signedIn([intro]))
    })))

  it.effect("change nothing when asked again, or for a class that is not there", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro])
      yield* store.watch(email, [intro])
      yield* store.unwatch(email, [ethics])
      yield* store.watch(email, [])
      yield* store.unwatch(email, [])
      assert.deepStrictEqual(yield* saved, signedIn([intro]))
    })))

  it.effect("write for the account they are given, whoever is signed in", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(other, "other-token")
      yield* store.watch(email, [intro])
      assert.deepStrictEqual(yield* saved, { ...signedIn(), email: other, token: "other-token" })
    })))

  it.effect("do not lose a change when several are made at the same moment", () =>
    withStore(Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, [intro, ethics])

      // The popup stops two alerts while a class page starts a third.
      yield* Effect.all([
        store.unwatch(email, [intro]),
        store.unwatch(email, [ethics]),
        store.watch(email, [introInFall])
      ], { concurrency: "unbounded" })

      assert.deepStrictEqual(yield* saved, signedIn([introInFall]))
    })))
})

describe("changes", () => {
  /**
   * Follow `changes` in the background and collect what it emits in a queue,
   * so a test can wait for "the next value" with `Queue.take`.
   */
  const startFollowing = Effect.gen(function*() {
    const store = yield* AccountStore
    const seen = yield* Queue.unbounded<Saved>()
    // `forkScoped`: run in the background until the test ends.
    yield* Effect.forkScoped(Stream.runForEach(store.changes, (value) => Queue.offer(seen, value)))
    return { store, seen }
  })

  it.effect("starts with the current value", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ email, token })
      const { seen } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), signedIn())
    })))

  it.effect("emits again after watch, unwatch, forgetToken and clear", () =>
    withStore(Effect.gen(function*() {
      yield* setRaw({ email, token })
      const { seen, store } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), signedIn())

      yield* store.watch(email, [intro])
      assert.deepStrictEqual(yield* Queue.take(seen), signedIn([intro]))

      yield* store.unwatch(email, [intro])
      assert.deepStrictEqual(yield* Queue.take(seen), signedIn())

      yield* store.forgetToken(token)
      assert.deepStrictEqual(yield* Queue.take(seen), signedOut({ email }))

      yield* store.clear
      assert.deepStrictEqual(yield* Queue.take(seen), signedOut())
    })))

  it.effect("sees a change made by another part of the extension", () =>
    withStore(Effect.gen(function*() {
      const { seen } = yield* startFollowing
      assert.deepStrictEqual(yield* Queue.take(seen), signedOut())

      // Not through this store: what a sign-in in the popup, or in the
      // sign-in frame, looks like from the "Notify me" control.
      yield* setRaw({ email, token })
      assert.deepStrictEqual(yield* Queue.take(seen), signedIn())
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
