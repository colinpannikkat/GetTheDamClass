import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { INTRO_TO_CS, makeTestServer } from "../test/TestServer"

// Through the API, against the whole server in this process (see
// test/TestServer.ts).

const email = "student@oregonstate.edu"

describe("deleteAccount", () => {
  it.effect("removes the account and its alerts, and ends the tokens of every browser", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const laptop = yield* server.client(yield* server.signIn(email))
      yield* TestClock.adjust("1 minute")
      const phone = yield* server.client(yield* server.signIn(email))
      yield* laptop.alerts.subscribe({ payload: INTRO_TO_CS })

      yield* laptop.account.deleteAccount()

      for (const browser of [laptop, phone]) {
        const error = yield* Effect.flip(browser.alerts.list())
        assert.strictEqual(error._tag, "NotSignedIn")
      }
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT * FROM accounts`, [])
      assert.deepStrictEqual(yield* sql`SELECT * FROM tokens`, [])
      assert.deepStrictEqual(yield* sql`SELECT * FROM alerts`, [])
    }))

  it.effect("leaves other accounts alone", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const leaving = yield* server.client(yield* server.signIn(email))
      const staying = yield* server.client(yield* server.signIn("other@example.com"))
      yield* leaving.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* staying.alerts.subscribe({ payload: INTRO_TO_CS })

      yield* leaving.account.deleteAccount()

      assert.deepStrictEqual(yield* staying.alerts.list(), [{ ...INTRO_TO_CS, title: "INTRO TO COMPUTER SCIENCE I" }])
    }))

  it.effect("signing in again afterwards starts a new, empty account", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client(yield* server.signIn(email))
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.account.deleteAccount()

      yield* TestClock.adjust("1 minute")
      const again = yield* server.client(yield* server.signIn(email))
      assert.deepStrictEqual(yield* again.alerts.list(), [])
    }))
})
