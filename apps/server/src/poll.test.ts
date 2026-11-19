import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestConsole } from "effect/testing"
import { INTRO_TO_CS, makeTestServer } from "../test/TestServer"
import { pollClasses } from "./poll"

// The check every minute, run on the same services as the whole server in
// this process (see test/TestServer.ts), after students subscribed through
// the API. The fake university knows INTRO_TO_CS, full, unless a test says
// otherwise.

const TITLE = "INTRO TO COMPUTER SCIENCE I"
const DATA_STRUCTURES = { term: "202702", crn: "12345" } as const

type TestServer = Effect.Success<ReturnType<typeof makeTestServer>>

/**
 * A server where each of these students watches INTRO_TO_CS (and so the
 * class is recorded as full), and their signed-in clients. The emails sent
 * so far (codes, confirmations) are cleared.
 */
const watching = (...emails: Array<string>) =>
  Effect.gen(function*() {
    const server = yield* makeTestServer()
    const students = []
    for (const email of emails) {
      const api = yield* server.client(yield* server.signIn(email))
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      students.push({ email, api })
    }
    server.mailer.sent.length = 0
    return { server, students }
  })

/** Have the university report this many of the class's 60 seats taken. */
const setEnrolled = (server: TestServer, key: string, enrolled: number) => {
  const known = server.university.classes.get(key)!
  server.university.classes.set(key, { ...known, seats: { enrolled, capacity: 60 } })
}

/** The recorded state of a class: 1 with a free seat, 0 when full. */
const recordedVacant = (server: TestServer, term: string, crn: string) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    const rows = yield* sql<{ vacant: number }>`SELECT vacant FROM classes WHERE term = ${term} AND crn = ${crn}`
    return rows[0]!.vacant
  })

/** The unsubscribe link in an email. */
const linkIn = (text: string) => text.match(/https:\/\/api\.test\/unsubscribe\?\S+/)![0]

describe("pollClasses", () => {
  it.effect("a seat opens: records it, and emails each watcher their own email with their own unsubscribe link", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("first@example.com", "second@example.com")
      setEnrolled(server, "202702/33940", 59)

      yield* server.run(pollClasses())

      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 1)
      const sent = server.mailer.sent
      assert.deepStrictEqual(sent.map((email) => email.to).sort(), ["first@example.com", "second@example.com"])
      for (const email of sent) {
        assert.strictEqual(email.subject, `Seat open: ${TITLE} (CRN 33940)`)
      }
      // Each link stops its own student's alert, and only that one.
      for (const [index, student] of students.entries()) {
        const email = sent.find((email) => email.to === student.email)!
        const response = yield* Effect.promise(() => server.fetch(linkIn(email.text), { method: "POST" }))
        assert.strictEqual(response.status, 200)
        assert.deepStrictEqual(yield* student.api.alerts.list(), [])
        for (const other of students.slice(index + 1)) {
          assert.strictEqual((yield* other.api.alerts.list()).length, 1)
        }
      }
    }))

  it.effect("the class fills again: records it, and emails that it is full", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      setEnrolled(server, "202702/33940", 59)
      yield* server.run(pollClasses())
      server.mailer.sent.length = 0

      setEnrolled(server, "202702/33940", 60)
      yield* server.run(pollClasses())

      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 0)
      assert.deepStrictEqual(server.mailer.sent.map((email) => email.subject), [`Full again: ${TITLE} (CRN 33940)`])
    }))

  it.effect("no change: no email, and nothing written", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      const sql = yield* server.sql
      const changes = sql<{ total: number }>`SELECT total_changes() AS total`
      const before = (yield* changes)[0]!.total

      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.university.calls.at(-1), "seats 202702/33940")
      assert.deepStrictEqual(server.mailer.sent, [])
      assert.strictEqual((yield* changes)[0]!.total, before)
    }))

  it.effect("a second run right after a change sends nothing more", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      setEnrolled(server, "202702/33940", 59)
      yield* server.run(pollClasses())
      yield* server.run(pollClasses())
      assert.strictEqual(server.mailer.sent.length, 1)
    }))

  it.effect("two runs that see the same change at once: only one of them emails", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      setEnrolled(server, "202702/33940", 59)

      // While this run waits for the university, a second run (the next
      // minute's, say) checks the class and sends the email. Both read the
      // class as full before either recorded the change.
      server.university.meanwhile = server.run(pollClasses()).pipe(Effect.orDie)
      yield* server.run(pollClasses())

      assert.strictEqual(server.mailer.sent.length, 1)
    }))

  it.effect("a class that fails to load is logged and keeps its state, and the others are still checked", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("student@example.com")
      server.university.classes.set("202702/12345", { title: "DATA STRUCTURES", seats: { enrolled: 60, capacity: 60 } })
      yield* students[0]!.api.alerts.subscribe({ payload: DATA_STRUCTURES })
      server.mailer.sent.length = 0

      // INTRO_TO_CS opens, but the university no longer finds it.
      setEnrolled(server, "202702/33940", 59)
      const intro = server.university.classes.get("202702/33940")!
      server.university.classes.delete("202702/33940")
      setEnrolled(server, "202702/12345", 59)

      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.mailer.sent.map((email) => email.subject), ["Seat open: DATA STRUCTURES (CRN 12345)"])
      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 0)
      assert.strictEqual((yield* students[0]!.api.alerts.list()).length, 2)
      // The warning, and which class it is about (as the log's annotations).
      const logged = yield* TestConsole.logLines
      assert.isTrue(logged.some((line) => String(line).startsWith("Could not check a class")))
      assert.deepInclude(logged, { term: "202702", crn: "33940" })

      // Once it loads again, its change is noticed after all.
      server.university.classes.set("202702/33940", intro)
      yield* server.run(pollClasses())
      assert.strictEqual(server.mailer.sent.at(-1)!.subject, `Seat open: ${TITLE} (CRN 33940)`)
    }))

  it.effect("while the university is down: the run still completes, and nothing changes", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("student@example.com")
      setEnrolled(server, "202702/33940", 59)
      server.university.down = true

      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.mailer.sent, [])
      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 0)
      assert.strictEqual((yield* students[0]!.api.alerts.list()).length, 1)
    }))

  it.effect("a failed send is logged with its reason, the others still go out, and it is not sent again", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("first@example.com", "bounces@example.com", "third@example.com")
      server.mailer.failingAddresses.set("bounces@example.com", "Mailbox full")
      setEnrolled(server, "202702/33940", 59)

      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.mailer.sent.map((email) => email.to).sort(), [
        "first@example.com",
        "third@example.com"
      ])
      const logged = (yield* TestConsole.logLines).join("\n")
      assert.include(logged, "Could not send a seat alert")
      assert.include(logged, "Mailbox full")

      server.mailer.failingAddresses.clear()
      yield* server.run(pollClasses())
      assert.strictEqual(server.mailer.sent.length, 2)
    }))

  it.effect("asks only about classes somebody watches", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("student@example.com")
      yield* students[0]!.api.alerts.unsubscribe({ params: INTRO_TO_CS })
      const calls = server.university.calls.length

      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.university.calls.slice(calls), [])
    }))
})
