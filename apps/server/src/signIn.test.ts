import { assert, describe, it } from "@effect/vitest"
import { EmailAddress } from "@getthedamclass/shared/domain"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { makeTestServer, PUBLIC_URL } from "../test/TestServer"

// These tests go through the API, with the typed client from
// packages/shared, against the whole server in this process (see
// test/TestServer.ts). The code is read from the email the server "sent".

const email = "student@oregonstate.edu"

/** A code that is surely not the right one. */
const wrongCodeFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0")

describe("sendCode", () => {
  it.effect("emails a six-digit code to the address", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      assert.strictEqual(server.mailer.sent.length, 1)
      const message = server.mailer.sent[0]!
      assert.strictEqual(message.to, email)
      const code = server.lastCode(email)
      assert.match(message.text, new RegExp(`Your sign-in code is ${code}`))
      assert.include(message.html, code)
    }))

  it.effect("sends to the address trimmed and in lower case", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      // A plain request, because the typed client only sends addresses it
      // has already cleaned up this way (with `EmailAddress`).
      const response = yield* Effect.promise(() =>
        server.fetch(`${PUBLIC_URL}/sign-in/code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "  Student@OregonState.EDU " })
        })
      )
      assert.strictEqual(response.status, 204)
      assert.strictEqual(server.mailer.sent[0]!.to, email)
    }))

  it.effect("sends one code per minute: a second request is CodeRecentlySent, with a sentence", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      yield* TestClock.adjust("59 seconds")
      const error = yield* Effect.flip(api.signIn.sendCode({ payload: { email } }))
      assert.strictEqual(error._tag, "CodeRecentlySent")
      assert.match(error.message, /wait a minute/)
      assert.strictEqual(server.mailer.sent.length, 1)
    }))

  it.effect("sends a new code once a minute has passed, and only the new one works", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const first = server.lastCode(email)
      yield* TestClock.adjust("1 minute")
      yield* api.signIn.sendCode({ payload: { email } })
      const second = server.lastCode(email)
      assert.strictEqual(server.mailer.sent.length, 2)
      if (first !== second) {
        const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: first } }))
        assert.strictEqual(error._tag, "InvalidCode")
      }
      yield* api.signIn.signIn({ payload: { email, code: second } })
    }))

  it.effect("counts the minute per address", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      yield* api.signIn.sendCode({ payload: { email: "other@example.com" } })
      assert.strictEqual(server.mailer.sent.length, 2)
    }))

  it.effect("when the email cannot be sent: EmailNotSent, and asking again works straight away", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      server.mailer.failure = "Sender address not verified"
      const error = yield* Effect.flip(api.signIn.sendCode({ payload: { email } }))
      assert.strictEqual(error._tag, "EmailNotSent")
      assert.match(error.message, /try again/)

      server.mailer.failure = undefined
      yield* api.signIn.sendCode({ payload: { email } })
      yield* api.signIn.signIn({ payload: { email, code: server.lastCode(email) } })
    }))

  it.effect("keeps only a hash of the code", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const sql = yield* server.sql
      const rows = yield* sql<{ codeHash: string }>`SELECT code_hash AS codeHash FROM sign_in_codes`
      assert.strictEqual(rows.length, 1)
      assert.notInclude(rows[0]!.codeHash, server.lastCode(email))
    }))
})

describe("signIn", () => {
  it.effect("with the emailed code: creates the account and returns a token that works", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const { token } = yield* api.signIn.signIn({ payload: { email, code: server.lastCode(email) } })
      const signedIn = yield* server.client(token)
      assert.deepStrictEqual(yield* signedIn.alerts.list(), [])
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT email FROM accounts`, [{ email }])
    }))

  it.effect("creates no account before a code is confirmed", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT * FROM accounts`, [])
    }))

  it.effect("signing in again, with the address in other letter case, uses the same account", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      yield* server.signIn(email)
      yield* TestClock.adjust("1 minute")
      yield* server.signIn(Schema.decodeSync(EmailAddress)(" STUDENT@oregonstate.edu"))
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT email FROM accounts`, [{ email }])
      assert.deepStrictEqual(yield* sql`SELECT COUNT(*) AS tokens FROM tokens`, [{ tokens: 2 }])
    }))

  it.effect("a new address gets a new account", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      yield* server.signIn(email)
      yield* server.signIn("someone@example.com")
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT email FROM accounts ORDER BY id`, [
        { email },
        { email: "someone@example.com" }
      ])
    }))

  it.effect("a code works once", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const code = server.lastCode(email)
      yield* api.signIn.signIn({ payload: { email, code } })
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code } }))
      assert.strictEqual(error._tag, "InvalidCode")
    }))

  it.effect("a wrong code is InvalidCode, with a sentence, and the right one still works after it", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const code = server.lastCode(email)
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: wrongCodeFor(code) } }))
      assert.strictEqual(error._tag, "InvalidCode")
      assert.match(error.message, /isn't right/)
      yield* api.signIn.signIn({ payload: { email, code } })
    }))

  it.effect("a code is for its own address only", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const error = yield* Effect.flip(
        api.signIn.signIn({ payload: { email: "other@example.com", code: server.lastCode(email) } })
      )
      assert.strictEqual(error._tag, "InvalidCode")
    }))

  it.effect("four wrong tries leave the code working; the fifth cancels it", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      const tryWrong = (code: string) =>
        Effect.flip(api.signIn.signIn({ payload: { email, code: wrongCodeFor(code) } }))

      yield* api.signIn.sendCode({ payload: { email } })
      const first = server.lastCode(email)
      for (let i = 0; i < 4; i++) yield* tryWrong(first)
      yield* api.signIn.signIn({ payload: { email, code: first } })

      yield* TestClock.adjust("1 minute")
      yield* api.signIn.sendCode({ payload: { email } })
      const second = server.lastCode(email)
      for (let i = 0; i < 5; i++) yield* tryWrong(second)
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: second } }))
      assert.strictEqual(error._tag, "InvalidCode")
    }))

  it.effect("a code works until 15 minutes after it was sent, and not from then on", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      yield* TestClock.adjust("14 minutes")
      yield* api.signIn.signIn({ payload: { email, code: server.lastCode(email) } })

      yield* api.signIn.sendCode({ payload: { email } })
      yield* TestClock.adjust("15 minutes")
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: server.lastCode(email) } }))
      assert.strictEqual(error._tag, "InvalidCode")
    }))

  it.effect("an address that never asked for a code gets the same InvalidCode", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: "123456" } }))
      assert.strictEqual(error._tag, "InvalidCode")
    }))

  it.effect("wrong, expired, cancelled and never-sent codes all answer the same", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      const answer = (address: string, code: string) =>
        Effect.flip(api.signIn.signIn({ payload: { email: address, code } }))

      const neverSent = yield* answer("never@example.com", "123456")

      yield* api.signIn.sendCode({ payload: { email: "wrong@example.com" } })
      const wrong = yield* answer("wrong@example.com", wrongCodeFor(server.lastCode("wrong@example.com")))

      yield* api.signIn.sendCode({ payload: { email: "cancelled@example.com" } })
      const cancelledCode = server.lastCode("cancelled@example.com")
      for (let i = 0; i < 5; i++) yield* answer("cancelled@example.com", wrongCodeFor(cancelledCode))
      const cancelled = yield* answer("cancelled@example.com", cancelledCode)

      yield* api.signIn.sendCode({ payload: { email: "expired@example.com" } })
      yield* TestClock.adjust("15 minutes")
      const expired = yield* answer("expired@example.com", server.lastCode("expired@example.com"))

      for (const error of [wrong, cancelled, expired]) {
        assert.deepStrictEqual(error, neverSent)
      }
    }))
})
