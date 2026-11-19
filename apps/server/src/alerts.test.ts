import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { setOregonTime } from "../test/oregonTime"
import { INTRO_TO_CS, makeTestServer, PUBLIC_URL, TERMS, type TestServer } from "../test/TestServer"

// Through the API, against the whole server in this process (see
// test/TestServer.ts). The fake university knows INTRO_TO_CS, full (60 of
// 60 seats taken), and the terms in TERMS, unless a test says otherwise. The
// clock starts in 1970, long before INTRO_TO_CS's add deadline.

const email = "student@oregonstate.edu"
const TITLE = "INTRO TO COMPUTER SCIENCE I"

/** A server, and a signed-in client for it. */
const signedIn = (address = email) =>
  Effect.gen(function*() {
    const server = yield* makeTestServer()
    const api = yield* server.client(yield* server.signIn(address))
    return { server, api }
  })

/** What the database remembers about a class. */
const classRow = (server: TestServer, term: string, crn: string) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    const rows = yield* sql<{ title: string; vacant: number; addDeadline: string | null }>`
      SELECT title, vacant, add_deadline AS addDeadline FROM classes WHERE term = ${term} AND crn = ${crn}
    `
    return rows[0]
  })

/** Everything in the two tables a subscribe writes to. */
const storedClassesAndAlerts = (server: TestServer) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    return { classes: yield* sql`SELECT * FROM classes`, alerts: yield* sql`SELECT * FROM alerts` }
  })

/** The university's answers for the whole lookup of a class nobody watches yet. */
const LOOKUP = ["classTitle 202702/33940", "seats 202702/33940", "meetingDates 202702/33940"]

describe("subscribe", () => {
  it.effect("to a class nobody watches: checks the term, looks the class up, records it, and returns the alert", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const alert = yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.deepStrictEqual(server.university.calls, ["terms", ...LOOKUP])
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), {
        title: TITLE,
        vacant: 0,
        addDeadline: "2027-01-17"
      })
    }))

  it.effect("to a class without dates: records no deadline", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 60, capacity: 60 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.strictEqual((yield* classRow(server, "202702", "33940"))!.addDeadline, null)
    }))

  it.effect("records a class with a free seat as vacant", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 59, capacity: 60 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.strictEqual((yield* classRow(server, "202702", "33940"))!.vacant, 1)
    }))

  it.effect("emails a confirmation naming the class, with an unsubscribe link that works", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      const confirmation = server.mailer.sent.at(-1)!
      assert.strictEqual(confirmation.to, email)
      assert.include(confirmation.subject, TITLE)
      assert.include(confirmation.text, `${TITLE} (CRN 33940)`)
      const link = confirmation.text.match(/https:\/\/\S+/)?.[0]
      assert.isDefined(link)
      assert.isTrue(link!.startsWith(`${PUBLIC_URL}/unsubscribe?key=`))
      assert.include(confirmation.html, `href="${link!}"`)

      const response = yield* Effect.promise(() => server.fetch(link!, { method: "POST" }))
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* api.alerts.list(), [])
    }))

  it.effect("to a class others watch: leaves its recorded state alone and only checks the term", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const callsBefore = server.university.calls.length

      // A seat opens, and before the check every minute notices it, another
      // student subscribes. Recording the free seat now would mean the first
      // student never hears about it.
      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 59, capacity: 60 } })
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      const alert = yield* other.alerts.subscribe({ payload: INTRO_TO_CS })

      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.deepStrictEqual(server.university.calls.slice(callsBefore), ["terms"])
      assert.strictEqual((yield* classRow(server, "202702", "33940"))!.vacant, 0)
      assert.strictEqual(server.mailer.sent.at(-1)!.to, "other@example.com")
    }))

  it.effect("when another student starts watching while the university is asked: their recorded class stands", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const other = yield* server.client(yield* server.signIn("other@example.com"))

      // While this student's request waits for the university, the other
      // student subscribes (seeing the class full), and then the university
      // renames the class and a seat opens. Writing what this request learns
      // would hide the open seat from the other student.
      server.university.meanwhile = Effect.gen(function*() {
        yield* other.alerts.subscribe({ payload: INTRO_TO_CS })
        server.university.classes.set("202702/33940", { title: "RENAMED", seats: { enrolled: 59, capacity: 60 } })
      }).pipe(Effect.orDie)
      const alert = yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), {
        title: TITLE,
        vacant: 0,
        addDeadline: "2027-01-17"
      })
      // The title this student is given is the one stored, as in their list.
      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.include(server.mailer.sent.at(-1)!.subject, TITLE)
    }))

  it.effect("when the only watcher has left: looks the class up afresh, since what was recorded is old", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      yield* other.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* other.alerts.unsubscribe({ params: INTRO_TO_CS })

      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 10, capacity: 60 } })
      const callsBefore = server.university.calls.length
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      assert.deepStrictEqual(server.university.calls.slice(callsBefore), ["terms", ...LOOKUP])
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), { title: TITLE, vacant: 1, addDeadline: null })
      assert.deepStrictEqual(yield* api.alerts.list(), [{ ...INTRO_TO_CS, title: TITLE }])
    }))

  it.effect("again: AlreadySubscribed, without looking the class up or sending another email", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const calls = server.university.calls.length
      const emails = server.mailer.sent.length

      const error = yield* Effect.flip(api.alerts.subscribe({ payload: INTRO_TO_CS }))
      assert.strictEqual(error._tag, "AlreadySubscribed")
      assert.deepStrictEqual(server.university.calls.slice(calls), ["terms"])
      assert.strictEqual(server.mailer.sent.length, emails)
    }))

  it.effect("from two browsers at once: one alert, and the later request is AlreadySubscribed", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      // A second browser signs in (the next code can be sent after a minute).
      yield* TestClock.adjust("1 minute")
      const secondBrowser = yield* server.client(yield* server.signIn(email))
      const emails = server.mailer.sent.length

      // While this request waits for the university, the other browser
      // subscribes to the same class, and so is first.
      server.university.meanwhile = secondBrowser.alerts.subscribe({ payload: INTRO_TO_CS }).pipe(Effect.asVoid, Effect.orDie)
      const error = yield* Effect.flip(api.alerts.subscribe({ payload: INTRO_TO_CS }))

      assert.strictEqual(error._tag, "AlreadySubscribed")
      assert.deepStrictEqual(yield* api.alerts.list(), [{ ...INTRO_TO_CS, title: TITLE }])
      assert.strictEqual(server.mailer.sent.length, emails + 1)
    }))

  it.effect("to the same CRN in another term: a separate alert", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202701/33940", { title: "WEB DEVELOPMENT", seats: { enrolled: 0, capacity: 30 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.subscribe({ payload: { term: "202701", crn: "33940" } })
      assert.deepStrictEqual(yield* api.alerts.list(), [
        { ...INTRO_TO_CS, title: TITLE },
        { term: "202701", crn: "33940", title: "WEB DEVELOPMENT" }
      ])
    }))

  it.effect("to a class the university does not know: ClassNotFound, and nothing is stored", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const error = yield* Effect.flip(api.alerts.subscribe({ payload: { term: "202702", crn: "99999" } }))
      assert.strictEqual(error._tag, "ClassNotFound")
      const sql = yield* server.sql
      assert.deepStrictEqual(yield* sql`SELECT * FROM classes`, [])
      assert.deepStrictEqual(yield* sql`SELECT * FROM alerts`, [])
    }))

  it.effect("while the university is down (the term list cannot be read): UniversityUnavailable, and nothing is stored", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.down = true
      const error = yield* Effect.flip(api.alerts.subscribe({ payload: INTRO_TO_CS }))
      assert.strictEqual(error._tag, "UniversityUnavailable")
      assert.deepStrictEqual(server.university.calls, ["terms"])
      assert.deepStrictEqual(yield* storedClassesAndAlerts(server), { classes: [], alerts: [] })
    }))

  it.effect("when the confirmation cannot be sent: the alert stays, and the request succeeds", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.mailer.failure = "Daily sending limit reached"
      const alert = yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.deepStrictEqual(yield* api.alerts.list(), [alert])
      const logged = (yield* TestConsole.logLines).join(" ")
      assert.include(logged, "Could not send a subscription confirmation")
      assert.include(logged, "Daily sending limit reached")
    }))

  it.effect("rejects a term that is not six digits, and a CRN that is not digits", () =>
    Effect.gen(function*() {
      const { server } = yield* signedIn()
      const token = yield* server.signIn("third@example.com")
      for (const payload of [{ term: "2027", crn: "33940" }, { term: "202702", crn: "CS161" }]) {
        const response = yield* Effect.promise(() =>
          server.fetch(`${PUBLIC_URL}/alerts`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(payload)
          })
        )
        assert.strictEqual(response.status, 400)
      }
      assert.deepStrictEqual(server.university.calls, [])
    }))
})

describe("subscribe: the term", () => {
  it.effect.each([
    { title: "not open yet", term: "202703", message: "Seat alerts for Spring 2027 start when registration opens." },
    {
      title: "over",
      term: "202700",
      message: "Registration for Summer 2026 has closed, so seat alerts for it have ended."
    },
    {
      title: "not listed by the university",
      term: "202504",
      message: "Oregon State's class search doesn't offer that term, so it can't have seat alerts."
    }
  ])("$title: TermNotOpen, with a sentence saying so, and nothing is looked up or stored", ({ message, term }) =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set(`${term}/33940`, { title: TITLE, seats: { enrolled: 0, capacity: 60 } })
      const error = yield* Effect.flip(api.alerts.subscribe({ payload: { term, crn: "33940" } }))
      assert.strictEqual(error._tag, "TermNotOpen")
      assert.strictEqual(error.message, message)
      assert.deepStrictEqual(server.university.calls, ["terms"])
      assert.deepStrictEqual(yield* storedClassesAndAlerts(server), { classes: [], alerts: [] })
    }))

  it.effect("is checked for a class others already watch, too", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      // Registration for Winter 2027 closes.
      server.university.terms = TERMS.map((term) => term.code === "202702" ? { ...term, open: false } : term)
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      const error = yield* Effect.flip(other.alerts.subscribe({ payload: INTRO_TO_CS }))

      assert.strictEqual(error._tag, "TermNotOpen")
      assert.deepStrictEqual(yield* other.alerts.list(), [])
    }))
})

describe("subscribe: the add deadline", () => {
  // INTRO_TO_CS's add deadline is Sunday 2027-01-17. A summer class shows
  // the same in daylight-saving time, when Oregon is 7 hours behind UTC
  // rather than 8.
  const SUMMER_2027 = { code: "202800", name: "Summer 2027", open: true }
  const SUMMER_CLASS = {
    title: "TECHNICAL WRITING",
    seats: { enrolled: 30, capacity: 30 },
    // Eight weeks from Monday 2027-06-21, so the deadline is Sunday 2027-07-04.
    dates: { starts: ["2027-06-21"], ends: ["2027-08-13"] }
  }
  const seasons = [
    {
      season: "winter",
      payload: INTRO_TO_CS,
      lastMinute: "2027-01-17T23:59",
      nextDay: "2027-01-18T00:00",
      named: "Sunday, January 17, 2027"
    },
    {
      season: "summer",
      payload: { term: "202800", crn: "40000" },
      lastMinute: "2027-07-04T23:59",
      nextDay: "2027-07-05T00:00",
      named: "Sunday, July 4, 2027"
    }
  ]

  /** A signed-in student, with the summer class and its term known too. */
  const withSummerClass = (address = email) =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn(address)
      server.university.terms = [SUMMER_2027, ...TERMS]
      server.university.classes.set("202800/40000", SUMMER_CLASS)
      return { server, api }
    })

  it.effect.each(seasons)(
    "$season: accepted late on the deadline day in Oregon, when it is already the next day in UTC",
    ({ lastMinute, payload }) =>
      Effect.gen(function*() {
        const { api } = yield* withSummerClass()
        yield* setOregonTime(lastMinute)
        yield* api.alerts.subscribe({ payload })
        assert.strictEqual((yield* api.alerts.list()).length, 1)
      })
  )

  it.effect.each(seasons)(
    "$season: from the next day in Oregon, AddDeadlinePassed naming the date, and no alert",
    ({ named, nextDay, payload }) =>
      Effect.gen(function*() {
        const { server, api } = yield* withSummerClass()
        yield* setOregonTime(nextDay)
        const error = yield* Effect.flip(api.alerts.subscribe({ payload }))
        assert.strictEqual(error._tag, "AddDeadlinePassed")
        assert.include(error.message, named)
        assert.deepStrictEqual((yield* storedClassesAndAlerts(server)).alerts, [])
      })
  )

  it.effect("for a class others watch: refused by its recorded deadline, without looking the class up", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* setOregonTime("2027-01-10T12:00")
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      yield* setOregonTime("2027-01-18T00:00")
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      const calls = server.university.calls.length
      const error = yield* Effect.flip(other.alerts.subscribe({ payload: INTRO_TO_CS }))

      assert.strictEqual(error._tag, "AddDeadlinePassed")
      assert.strictEqual(
        error.message,
        "The last day to add INTRO TO COMPUTER SCIENCE I (CRN 33940) was Sunday, January 17, 2027, so seat alerts for it have ended."
      )
      assert.deepStrictEqual(server.university.calls.slice(calls), ["terms"])
      assert.deepStrictEqual(yield* other.alerts.list(), [])
    }))

  it.effect("a class without dates: accepted whenever its term is open", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 60, capacity: 60 } })
      yield* setOregonTime("2027-06-01T12:00")
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      yield* other.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.strictEqual((yield* other.alerts.list()).length, 1)
    }))
})

describe("unsubscribe", () => {
  it.effect("stops the alert, without asking the university", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const calls = server.university.calls.length

      // Even a class the university no longer knows (a past term's) can be stopped.
      server.university.down = true
      yield* api.alerts.unsubscribe({ params: INTRO_TO_CS })

      assert.deepStrictEqual(yield* api.alerts.list(), [])
      assert.strictEqual(server.university.calls.length, calls)
    }))

  it.effect("from a class without an alert: NotSubscribed", () =>
    Effect.gen(function*() {
      const { api } = yield* signedIn()
      const error = yield* Effect.flip(api.alerts.unsubscribe({ params: INTRO_TO_CS }))
      assert.strictEqual(error._tag, "NotSubscribed")
    }))

  it.effect("stops only this account's alert", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* other.alerts.subscribe({ payload: INTRO_TO_CS })

      yield* api.alerts.unsubscribe({ params: INTRO_TO_CS })

      assert.deepStrictEqual(yield* other.alerts.list(), [{ ...INTRO_TO_CS, title: TITLE }])
    }))
})

describe("list", () => {
  it.effect("is every alert of the account, with term, CRN and title, from the database alone", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202702/12345", { title: "DATA STRUCTURES", seats: { enrolled: 1, capacity: 2 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.subscribe({ payload: { term: "202702", crn: "12345" } })
      const other = yield* server.client(yield* server.signIn("other@example.com"))
      yield* other.alerts.subscribe({ payload: INTRO_TO_CS })
      const calls = server.university.calls.length

      assert.deepStrictEqual(yield* api.alerts.list(), [
        { ...INTRO_TO_CS, title: TITLE },
        { term: "202702", crn: "12345", title: "DATA STRUCTURES" }
      ])
      assert.strictEqual(server.university.calls.length, calls)
    }))
})
