import { assert, describe, it } from "@effect/vitest"
import { EmailAddress, EmailNotSent } from "@getthedamclass/shared/domain"
import { Effect, Latch, Schema } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { INTRO_TO_CS, makeTestServer, PUBLIC_URL, type TestServer } from "../test/TestServer"
import { pollClasses } from "./poll"

const email = "student@oregonstate.edu"

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
      assert.notStrictEqual(first, second)
      const error = yield* Effect.flip(api.signIn.signIn({ payload: { email, code: first } }))
      assert.strictEqual(error._tag, "InvalidCode")
      yield* api.signIn.signIn({ payload: { email, code: second } })
    }))

  it.effect("signing in does not end the minute: the next code still waits for it", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* server.signIn(email)
      const error = yield* Effect.flip(api.signIn.sendCode({ payload: { email } }))
      assert.strictEqual(error._tag, "CodeRecentlySent")
      assert.notInclude(error.message, "inbox")
      yield* TestClock.adjust("1 minute")
      yield* api.signIn.sendCode({ payload: { email } })
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
      const logged = (yield* TestConsole.logLines).join(" ")
      assert.include(logged, "Could not send a sign-in code")
      assert.include(logged, "Sender address not verified")

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

describe("sendCode, when the request is dropped while the email is being sent", () => {
  const askAndDrop = (server: TestServer) =>
    Effect.gen(function*() {
      const sending = Latch.makeUnsafe()
      const sendNow = Latch.makeUnsafe()
      server.mailer.beforeSend = Latch.open(sending).pipe(Effect.andThen(Latch.await(sendNow)))
      const dropped = new AbortController()
      const response = server.fetch(`${PUBLIC_URL}/sign-in/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal: dropped.signal
      })
      yield* Latch.await(sending)
      dropped.abort()
      yield* Latch.open(sendNow)
      yield* Effect.promise(() => response)
      server.mailer.beforeSend = undefined
    })

  it.effect("still sends the email, and the code works", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      yield* askAndDrop(server)
      assert.strictEqual(server.mailer.sent.length, 1)
      const api = yield* server.client()
      yield* api.signIn.signIn({ payload: { email, code: server.lastCode(email) } })
    }))

  it.effect("still forgets the code when the email cannot be sent, so asking again works straight away", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      server.mailer.failure = "Sender address not verified"
      yield* askAndDrop(server)

      server.mailer.failure = undefined
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      assert.strictEqual(server.mailer.sent.length, 1)
    }))
})

describe("sendCode, past the day's cap on sign-in emails", () => {
  const TOO_MANY = "Too many sign-in emails were sent today. Please try again tomorrow."

  const ask = (server: TestServer, address: string) =>
    Effect.gen(function*() {
      const api = yield* server.client()
      return yield* api.signIn.sendCode({ payload: { email: address } }).pipe(
        Effect.as("sent"),
        Effect.catch((error) => Effect.succeed(error._tag))
      )
    })

  const storedCodes = (server: TestServer) =>
    Effect.gen(function*() {
      const sql = yield* server.sql
      const rows = yield* sql<{ email: string }>`SELECT email FROM sign_in_codes ORDER BY email`
      return rows.map((row) => row.email)
    })

  it.effect("is EmailNotSent, with its own sentence, and nothing is sent or stored", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 2 })
      assert.strictEqual(yield* ask(server, "a@example.com"), "sent")
      assert.strictEqual(yield* ask(server, "b@example.com"), "sent")
      const api = yield* server.client()
      const error = yield* Effect.flip(api.signIn.sendCode({ payload: { email: "c@example.com" } }))
      assert.deepStrictEqual(error, new EmailNotSent({ message: TOO_MANY }))
      assert.deepStrictEqual(server.mailer.sent.map((sent) => sent.to), ["a@example.com", "b@example.com"])
      assert.deepStrictEqual(yield* storedCodes(server), ["a@example.com", "b@example.com"])
    }))

  it.effect("leaves a code that already works alone: a student refused a new one can still use it", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 1 })
      assert.strictEqual(yield* ask(server, "a@example.com"), "sent")
      const code = server.lastCode("a@example.com")
      yield* TestClock.adjust("2 minutes")
      assert.strictEqual(yield* ask(server, "a@example.com"), "EmailNotSent")
      const api = yield* server.client()
      yield* api.signIn.signIn({ payload: { email: "a@example.com", code } })
    }))

  it.effect("counts an email that could not be sent", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 1 })
      server.mailer.failure = "Cloudflare said no"
      assert.strictEqual(yield* ask(server, "a@example.com"), "EmailNotSent")
      server.mailer.failure = undefined
      const api = yield* server.client()
      const error = yield* Effect.flip(api.signIn.sendCode({ payload: { email: "b@example.com" } }))
      assert.deepStrictEqual(error, new EmailNotSent({ message: TOO_MANY }))
    }))

  it.effect("counts only emails sent: a request refused for the minute does not use one up", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 2 })
      yield* ask(server, "a@example.com")
      assert.strictEqual(yield* ask(server, "a@example.com"), "CodeRecentlySent")
      assert.strictEqual(yield* ask(server, "b@example.com"), "sent")
    }))

  it.effect("starts again at midnight UTC, and the refused address can ask straight away", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 1 })
      yield* TestClock.setTime(Date.parse("2026-11-19T23:59:30Z"))
      yield* ask(server, "a@example.com")
      assert.strictEqual(yield* ask(server, "b@example.com"), "EmailNotSent")

      yield* TestClock.setTime(Date.parse("2026-11-19T23:59:50Z"))
      assert.strictEqual(yield* ask(server, "b@example.com"), "EmailNotSent")

      yield* TestClock.setTime(Date.parse("2026-11-20T00:00:00Z"))
      assert.strictEqual(yield* ask(server, "b@example.com"), "sent")
      const api = yield* server.client()
      yield* api.signIn.signIn({ payload: { email: "b@example.com", code: server.lastCode("b@example.com") } })
    }))

  it.effect("many requests at the same moment for the last email: exactly one is sent", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 3 })
      yield* ask(server, "first@example.com")
      yield* ask(server, "second@example.com")
      const addresses = Array.from({ length: 10 }, (_, i) => `student${i}@example.com`)
      const results = yield* Effect.all(addresses.map((address) => ask(server, address)), { concurrency: "unbounded" })
      assert.strictEqual(results.filter((result) => result === "sent").length, 1)
      assert.strictEqual(results.filter((result) => result === "EmailNotSent").length, 9)
      assert.strictEqual(server.mailer.sent.length, 3)
      assert.strictEqual((yield* storedCodes(server)).length, 3)
    }))

  it.effect("logs one warning when the cap is reached, without any address", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 2 })
      for (const address of ["a@example.com", "b@example.com", "c@example.com", "d@example.com"]) {
        yield* ask(server, address)
      }
      const logged = yield* TestConsole.logLines
      const reached = logged.flatMap((part, i) =>
        String(part).includes("Reached the day's cap on sign-in emails") ? [logged[i - 1]] : []
      )
      assert.strictEqual(reached.length, 1)
      assert.include(reached[0], "WARN")
      assert.deepInclude(logged, { cap: 2 })
      assert.notInclude(logged.map((part) => JSON.stringify(part)).join(" "), "@example.com")
    }))

  it.effect("does not stop subscription confirmations or seat alerts", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({ signInEmailsPerDay: 1 })
      const student = "student@oregonstate.edu"
      const api = yield* server.client(yield* server.signIn(student))
      assert.strictEqual(yield* ask(server, "other@example.com"), "EmailNotSent")

      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.match(server.mailer.sent.at(-1)!.subject, /^Watching INTRO TO COMPUTER SCIENCE I/)

      const key = `${INTRO_TO_CS.term}/${INTRO_TO_CS.crn}`
      server.university.classes.set(key, { ...server.university.classes.get(key)!, seats: { enrolled: 59, capacity: 60 } })
      yield* server.run(pollClasses())
      assert.deepStrictEqual(server.mailer.sent.map((sent) => sent.to), [student, student, student])
      assert.match(server.mailer.sent.at(-1)!.subject, /^Seat open/)
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

  it.effect("the same code sent twice at the same moment signs in once", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const code = server.lastCode(email)
      const results = yield* Effect.all(
        [1, 2].map(() => Effect.result(api.signIn.signIn({ payload: { email, code } }))),
        { concurrency: "unbounded" }
      )
      assert.deepStrictEqual(results.map((result) => result._tag).sort(), ["Failure", "Success"])
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT COUNT(*) AS tokens FROM tokens`, [{ tokens: 1 }])
    }))

  it.effect("many codes sent at the same moment are each a try: ten wrong ones cancel the right one sent with them", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client()
      yield* api.signIn.sendCode({ payload: { email } })
      const code = server.lastCode(email)
      // The requests reach the server in this order, so the right code is the eleventh try.
      const guesses = [...Array.from({ length: 10 }, () => wrongCodeFor(code)), code]
      const errors = yield* Effect.all(
        guesses.map((guess) => Effect.flip(api.signIn.signIn({ payload: { email, code: guess } }))),
        { concurrency: "unbounded" }
      )
      assert.deepStrictEqual(errors.map((error) => error._tag), guesses.map(() => "InvalidCode"))
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
