import { assert, describe, it } from "@effect/vitest"
import { NotSignedIn } from "@getthedamclass/shared/domain"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { makeTestServer, PUBLIC_URL } from "../test/TestServer"

const email = "student@oregonstate.edu"

describe("requests without a valid token", () => {
  it.effect("no Authorization header: NotSignedIn, HTTP 401, with a sentence", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const response = yield* Effect.promise(() => server.fetch(`${PUBLIC_URL}/alerts`))
      assert.strictEqual(response.status, 401)
      const error = Schema.decodeUnknownSync(NotSignedIn)(yield* Effect.promise(() => response.json()))
      assert.match(error.message, /Sign in/)
    }))

  it.effect.each([
    { title: "an unknown token", authorization: "Bearer not-a-token" },
    { title: "another scheme", authorization: "Basic c3R1ZGVudDpwYXNz" },
    { title: "an empty token", authorization: "Bearer " }
  ])("$title: HTTP 401", ({ authorization }) =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const response = yield* Effect.promise(() => server.fetch(`${PUBLIC_URL}/alerts`, { headers: { authorization } }))
      assert.strictEqual(response.status, 401)
    }))

  it.effect("the typed client gets NotSignedIn for every signed-in endpoint", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client("not-a-token")
      const errors = [
        yield* Effect.flip(api.alerts.list()),
        yield* Effect.flip(api.alerts.subscribe({ payload: { term: "202702", crn: "33940" } })),
        yield* Effect.flip(api.alerts.unsubscribe({ params: { term: "202702", crn: "33940" } })),
        yield* Effect.flip(api.account.signOut()),
        yield* Effect.flip(api.account.deleteAccount())
      ]
      assert.deepStrictEqual(errors.map((error) => error._tag), Array(5).fill("NotSignedIn"))
      assert.deepStrictEqual(server.university.calls, [])
    }))
})

describe("tokens", () => {
  it.effect("are sent as `Authorization: Bearer`", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const token = yield* server.signIn(email)
      const response = yield* Effect.promise(() =>
        server.fetch(`${PUBLIC_URL}/alerts`, { headers: { authorization: `Bearer ${token}` } })
      )
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), [])
    }))

  it.effect("two browsers hold two tokens, and signing out ends only its own", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const laptop = yield* server.client(yield* server.signIn(email))
      yield* TestClock.adjust("1 minute")
      const phone = yield* server.client(yield* server.signIn(email))

      yield* laptop.account.signOut()

      const error = yield* Effect.flip(laptop.alerts.list())
      assert.strictEqual(error._tag, "NotSignedIn")
      assert.deepStrictEqual(yield* phone.alerts.list(), [])
    }))

  it.effect("are kept only as hashes", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const token = yield* server.signIn(email)
      const sql = yield* server.sql
      const rows = yield* sql<{ tokenHash: string }>`SELECT token_hash AS tokenHash FROM tokens`
      assert.strictEqual(rows.length, 1)
      assert.notStrictEqual(rows[0]!.tokenHash, token)
      assert.notInclude(rows[0]!.tokenHash, token)
    }))

  it.effect("record when they were last used, at most once a day", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client(yield* server.signIn(email))
      const sql = yield* server.sql
      const lastUsed = Effect.map(
        sql<{ lastUsedAt: number }>`SELECT last_used_at AS lastUsedAt FROM tokens`,
        (rows) => rows[0]!.lastUsedAt
      )
      const signedInAt = yield* lastUsed

      yield* TestClock.adjust("23 hours")
      yield* api.alerts.list()
      assert.strictEqual(yield* lastUsed, signedInAt)

      yield* TestClock.adjust("1 hour")
      yield* api.alerts.list()
      assert.strictEqual(yield* lastUsed, signedInAt + 24 * 60 * 60 * 1000)
    }))
})
