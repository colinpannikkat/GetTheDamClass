import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Tracer } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestConsole } from "effect/testing"
import { INTRO_TO_CS, makeTestServer, type TestServer } from "../test/TestServer"
import { pollClasses } from "./poll"
import { University } from "./University"

// The check every minute, run on the same services as the whole server in
// this process (see test/TestServer.ts), after students subscribed through
// the API. The fake university knows INTRO_TO_CS, full, unless a test says
// otherwise.

const TITLE = "INTRO TO COMPUTER SCIENCE I"
const DATA_STRUCTURES = { term: "202702", crn: "12345" } as const

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

/**
 * Run the check, and return the SQL of every statement it sent to the
 * database. Effect traces each statement as a span carrying its SQL, so a
 * tracer that keeps the spans sees them all.
 */
const pollCountingStatements = (server: TestServer) =>
  Effect.gen(function*() {
    const spans: Array<Tracer.NativeSpan> = []
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      }
    })
    yield* server.run(pollClasses()).pipe(Effect.withTracer(tracer))
    return spans.flatMap((span) => {
      const sql = span.attributes.get("db.query.text")
      return sql === undefined ? [] : [String(sql)]
    })
  })

/** The key in each student's unsubscribe link for INTRO_TO_CS, by address. */
const unsubscribeKeys = (server: TestServer) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    const rows = yield* sql<{ email: string; key: string }>`
      SELECT accounts.email AS email, alerts.unsubscribe_key AS key
      FROM alerts JOIN accounts ON accounts.id = alerts.account_id
      WHERE alerts.term = ${INTRO_TO_CS.term} AND alerts.crn = ${INTRO_TO_CS.crn}
    `
    return new Map(rows.map((row) => [row.email, row.key]))
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

  it.effect("no change: no email, and no statement beyond reading the watch list", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")

      const statements = yield* pollCountingStatements(server)

      assert.deepStrictEqual(server.university.calls.at(-1), "seats 202702/33940")
      assert.deepStrictEqual(server.mailer.sent, [])
      // D1 allows a run a set number of statements (see poll.ts), so a class
      // that has not changed must not cost one.
      assert.strictEqual(statements.length, 1)
      assert.match(statements[0]!, /^\s*SELECT term, crn, title, vacant FROM classes/)
    }))

  it.effect("a change: one statement beyond reading the watch list, which records it and reads the watchers", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("first@example.com", "second@example.com")
      setEnrolled(server, "202702/33940", 59)

      const statements = yield* pollCountingStatements(server)

      assert.strictEqual(server.mailer.sent.length, 2)
      // One statement both records the change and reads who to email, so
      // nothing can happen between the two (see `recordChange` in poll.ts).
      // The limits note there counts on it too.
      assert.strictEqual(statements.length, 2)
      assert.match(statements[1]!, /^\s*UPDATE classes SET vacant/)
    }))

  it.effect("emails who watches when the change is recorded, not when the run began, each with their own link", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("first@example.com", "leaving@example.com")
      const joining = yield* server.client(yield* server.signIn("joining@example.com"))
      server.mailer.sent.length = 0
      setEnrolled(server, "202702/33940", 59)

      // While the run waits for the university, after it read the watch
      // list, one student stops watching the class and another starts.
      server.university.meanwhile = Effect.gen(function*() {
        yield* students[1]!.api.alerts.unsubscribe({ params: INTRO_TO_CS })
        yield* joining.alerts.subscribe({ payload: INTRO_TO_CS })
        server.mailer.sent.length = 0 // their confirmation
      }).pipe(Effect.orDie)
      yield* server.run(pollClasses())

      const sent = server.mailer.sent
      assert.deepStrictEqual(sent.map((email) => email.to).sort(), ["first@example.com", "joining@example.com"])
      const keys = yield* unsubscribeKeys(server)
      for (const email of sent) {
        assert.include(linkIn(email.text), keys.get(email.to)!)
      }
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
      assert.include(logged, "Could not check a class: the university has no class with this CRN in this term")
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

  it.effect("an outage logs one line per class, with the reason, the term and the CRN", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      // The real University, on a `fetch` that answers every request with
      // HTTP 503, since the line that says why comes from University.ts.
      const failing = University.layer.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, () => Promise.resolve(new Response("", { status: 503 }))))
      )
      const before = (yield* TestConsole.logLines).length

      yield* server.run(pollClasses().pipe(Effect.provide(failing)))

      // Each log line starts with its time and level, as in
      // "[16:00:00.000] WARN (#43):".
      const logged = (yield* TestConsole.logLines).slice(before)
      const warnings = logged.filter((line) => /^\[[\d:.]+\] (WARN|ERROR)/.test(String(line)))
      assert.strictEqual(warnings.length, 1)
      assert.include(logged, "getEnrollmentInfo: HTTP 503")
      assert.deepInclude(logged, { term: "202702", crn: "33940" })
    }))

  it.effect("if recording the change fails, nothing is sent, and the next run records it and emails", () =>
    Effect.gen(function*() {
      const { server } = yield* watching("student@example.com")
      const sql = yield* server.sql
      setEnrolled(server, "202702/33940", 59)

      // The statement that records the change is the check's only query of
      // `accounts` (it reads the watchers too), so hiding the table makes
      // that one statement fail, as a database error would.
      server.university.meanwhile = Effect.orDie(sql`ALTER TABLE accounts RENAME TO hidden_accounts`)
      yield* server.run(pollClasses())
      assert.deepStrictEqual(server.mailer.sent, [])
      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 0)

      yield* sql`ALTER TABLE hidden_accounts RENAME TO accounts`
      yield* server.run(pollClasses())
      assert.deepStrictEqual(server.mailer.sent.map((email) => email.subject), [`Seat open: ${TITLE} (CRN 33940)`])
      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 1)
    }))

  it.effect("a class failing in any other way is logged, and the run still checks the others and completes", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("student@example.com")
      server.university.classes.set("202702/12345", { title: "DATA STRUCTURES", seats: { enrolled: 60, capacity: 60 } })
      yield* students[0]!.api.alerts.subscribe({ payload: DATA_STRUCTURES })
      server.mailer.sent.length = 0
      setEnrolled(server, "202702/33940", 59)
      setEnrolled(server, "202702/12345", 59)

      // The first class asked about, INTRO_TO_CS (recorded first), fails
      // with a defect, as a bug would.
      server.university.meanwhile = Effect.die(new Error("A bug (in this test)"))
      yield* server.run(pollClasses())

      assert.deepStrictEqual(server.mailer.sent.map((email) => email.subject), ["Seat open: DATA STRUCTURES (CRN 12345)"])
      assert.strictEqual(yield* recordedVacant(server, "202702", "33940"), 0)
      const logged = yield* TestConsole.logLines
      assert.isTrue(logged.some((line) => String(line).startsWith("Could not check a class; the next run tries again")))
      assert.deepInclude(logged, { term: "202702", crn: "33940" })

      // It keeps its change for the next run.
      yield* server.run(pollClasses())
      assert.strictEqual(server.mailer.sent.length, 2)
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

  it.effect("logs one line per run: how many classes it checked, how many changed, and how many failed", () =>
    Effect.gen(function*() {
      const { server, students } = yield* watching("student@example.com")
      server.university.classes.set("202702/12345", { title: "DATA STRUCTURES", seats: { enrolled: 60, capacity: 60 } })
      yield* students[0]!.api.alerts.subscribe({ payload: DATA_STRUCTURES })
      setEnrolled(server, "202702/33940", 59)

      yield* server.run(pollClasses())

      const logged = yield* TestConsole.logLines
      assert.include(logged, "Checked the watched classes:")
      assert.deepInclude(logged, { checked: 2, changed: 1, failed: 0 })
    }))
})
