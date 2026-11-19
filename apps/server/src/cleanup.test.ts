import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { setOregonTime } from "../test/oregonTime"
import { INTRO_TO_CS, makeTestServer, type TestServer } from "../test/TestServer"
import { cleanup } from "./cleanup"

// The daily job, run on the same services as the whole server in this
// process (see test/TestServer.ts), after students signed in and subscribed
// through the API. INTRO_TO_CS's add deadline is Sunday 2027-01-17. (Tests
// stay within the year of signing in, unless they are about that year: past
// it, the job signs the student out.)

/** Another class in the same term, with a later deadline: Sunday 2027-01-24. */
const LATE_START = { term: "202702", crn: "12345" } as const
/** A class without dates, in Fall 2026. */
const NO_DATES = { term: "202701", crn: "55555" } as const

/** A server whose university knows the two classes above too, and a student who signs in on 2027-01-10. */
const signedIn = Effect.gen(function*() {
  const server = yield* makeTestServer()
  yield* setOregonTime("2027-01-10T12:00")
  server.university.classes.set("202702/12345", {
    title: "DATA STRUCTURES",
    seats: { enrolled: 60, capacity: 60 },
    dates: { starts: ["2027-01-11"], ends: ["2027-03-12"] }
  })
  server.university.classes.set("202701/55555", { title: "INTERNSHIP", seats: { enrolled: 0, capacity: 10 } })
  const api = yield* server.client(yield* server.signIn("student@example.com"))
  return { server, api }
})

/** The classes the student gets alerts for, as "term/crn". */
const alertsOf = (api: Effect.Success<typeof signedIn>["api"]) =>
  Effect.map(api.alerts.list(), (alerts) => alerts.map((alert) => `${alert.term}/${alert.crn}`))

/** The classes recorded, as "term/crn". */
const recordedClasses = (server: TestServer) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    const rows = yield* sql<{ term: string; crn: string }>`SELECT term, crn FROM classes ORDER BY term, crn`
    return rows.map((row) => `${row.term}/${row.crn}`)
  })

/** Close a term in the fake university's term list. */
const closeTerm = (server: TestServer, code: string) => {
  server.university.terms = server.university.terms.map((term) => term.code === code ? { ...term, open: false } : term)
}

describe("cleanup: alerts", () => {
  it.effect("removes alerts once their class's deadline has passed in Oregon, and keeps the others", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.subscribe({ payload: LATE_START })

      // The last minute of the deadline day: still kept.
      yield* setOregonTime("2027-01-17T23:59")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), ["202702/33940", "202702/12345"])

      yield* setOregonTime("2027-01-18T03:00")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), ["202702/12345"])
    }))

  it.effect("keeps the alerts of a class without dates while its term is open, and removes them after", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: NO_DATES })

      yield* setOregonTime("2027-12-01T03:00")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), ["202701/55555"])

      closeTerm(server, "202701")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), [])
    }))

  it.effect("when the term list cannot be read: removes no alerts, and says so in the log", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      closeTerm(server, "202702")

      server.university.down = true
      yield* setOregonTime("2027-02-01T03:00")
      yield* server.run(cleanup())

      assert.deepStrictEqual(yield* alertsOf(api), ["202702/33940"])
      assert.include((yield* TestConsole.logLines).join("\n"), "Could not read the term list")
    }))

  it.effect("a class with dates keeps its alerts until its deadline, even once its term is closed", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      closeTerm(server, "202702")

      yield* setOregonTime("2027-01-12T03:00")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), ["202702/33940"])

      yield* setOregonTime("2027-01-18T03:00")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* alertsOf(api), [])
    }))

  it.effect("a term missing from the list counts as open: a broken answer can leave one out", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: NO_DATES })
      server.university.terms = server.university.terms.filter((term) => term.code !== "202701")

      yield* server.run(cleanup())

      assert.deepStrictEqual(yield* alertsOf(api), ["202701/55555"])
    }))
})

describe("cleanup: classes", () => {
  it.effect("removes classes nobody watches once their term is closed, and keeps those of open terms", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      for (const payload of [INTRO_TO_CS, NO_DATES]) {
        yield* api.alerts.subscribe({ payload })
        yield* api.alerts.unsubscribe({ params: payload })
      }

      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* recordedClasses(server), ["202701/55555", "202702/33940"])

      closeTerm(server, "202701")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* recordedClasses(server), ["202702/33940"])
    }))

  it.effect("keeps them while their term is missing from the list", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: NO_DATES })
      yield* api.alerts.unsubscribe({ params: NO_DATES })
      server.university.terms = server.university.terms.filter((term) => term.code !== "202701")

      yield* server.run(cleanup())

      assert.deepStrictEqual(yield* recordedClasses(server), ["202701/55555"])
    }))
})

describe("cleanup: the log", () => {
  it.effect("ends each run with one line saying how much each removal removed", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.subscribe({ payload: NO_DATES })
      yield* api.alerts.unsubscribe({ params: NO_DATES })
      closeTerm(server, "202701")
      // Past INTRO_TO_CS's deadline, and the sign-in code has long expired.
      yield* setOregonTime("2027-01-18T03:00")

      yield* server.run(cleanup())

      const logged = yield* TestConsole.logLines
      assert.include(logged, "Daily cleanup done. Removed:")
      assert.deepInclude(logged, { signInCodes: 1, tokens: 0, alerts: 1, classes: 1 })
    }))
})

describe("cleanup: sign-in codes and tokens", () => {
  /** How many sign-in codes are stored. */
  const storedCodes = (server: TestServer) =>
    Effect.gen(function*() {
      const sql = yield* server.sql
      return (yield* sql`SELECT * FROM sign_in_codes`).length
    })

  it.effect("removes codes once they have expired", () =>
    Effect.gen(function*() {
      const { server } = yield* signedIn
      const api = yield* server.client()
      yield* TestClock.adjust("1 minute")
      yield* api.signIn.sendCode({ payload: { email: "other@example.com" } })

      // Codes work for 15 minutes; the first one has been used.
      yield* TestClock.adjust("14 minutes")
      yield* server.run(cleanup())
      assert.strictEqual(yield* storedCodes(server), 1)

      yield* TestClock.adjust("1 minute")
      yield* server.run(cleanup())
      assert.strictEqual(yield* storedCodes(server), 0)
    }))

  it.effect("removes tokens unused for a year, and keeps one used within it", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const unused = yield* server.client(yield* server.signIn("unused@example.com"))
      const used = yield* server.client(yield* server.signIn("used@example.com"))

      yield* TestClock.adjust("200 days")
      yield* used.alerts.list()
      yield* TestClock.adjust("166 days")
      yield* server.run(cleanup())

      assert.strictEqual((yield* Effect.flip(unused.alerts.list()))._tag, "NotSignedIn")
      assert.deepStrictEqual(yield* used.alerts.list(), [])
    }))

  it.effect("keeps a token whose last use was too recent to be written down", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const api = yield* server.client(yield* server.signIn("student@example.com"))
      // Used 23 hours after signing in: within the day in which `last_used_at`
      // is not written again, so the database still says "signed in".
      yield* TestClock.adjust("23 hours")
      yield* api.alerts.list()

      // A year after signing in, but an hour short of a year after that use.
      yield* TestClock.adjust(Duration.subtract(Duration.days(365), Duration.hours(23)))
      yield* server.run(cleanup())
      // Asked of the database, so that asking does not count as a use.
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT COUNT(*) AS tokens FROM tokens`, [{ tokens: 1 }])

      yield* TestClock.adjust("1 day")
      yield* server.run(cleanup())
      assert.deepStrictEqual(yield* sql`SELECT COUNT(*) AS tokens FROM tokens`, [{ tokens: 0 }])
    }))

  it.effect("removes them even when the term list cannot be read", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn
      server.university.down = true

      // A year, and the day a token's last use can go unrecorded.
      yield* TestClock.adjust("366 days")
      yield* server.run(cleanup())

      assert.strictEqual(yield* storedCodes(server), 0)
      assert.strictEqual((yield* Effect.flip(api.alerts.list()))._tag, "NotSignedIn")
    }))
})
