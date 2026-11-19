import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { INTRO_TO_CS, makeTestServer, PUBLIC_URL } from "../test/TestServer"

// Through the API, against the whole server in this process (see
// test/TestServer.ts). The fake university knows INTRO_TO_CS, full (60 of
// 60 seats taken), unless a test says otherwise.

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
const classRow = (server: Effect.Success<ReturnType<typeof makeTestServer>>, term: string, crn: string) =>
  Effect.gen(function*() {
    const sql = yield* server.sql
    const rows = yield* sql<{ title: string; vacant: number }>`
      SELECT title, vacant FROM classes WHERE term = ${term} AND crn = ${crn}
    `
    return rows[0]
  })

describe("subscribe", () => {
  it.effect("to a class nobody watches: looks it up, records its title and state, and returns the alert", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      const alert = yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.deepStrictEqual(server.university.calls, ["classTitle 202702/33940", "seats 202702/33940"])
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), { title: TITLE, vacant: 0 })
    }))

  it.effect("records a class with a free seat as vacant", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 59, capacity: 60 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), { title: TITLE, vacant: 1 })
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

  it.effect("to a class others watch: leaves its recorded state alone and does not ask the university", () =>
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
      assert.strictEqual(server.university.calls.length, callsBefore)
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), { title: TITLE, vacant: 0 })
      assert.strictEqual(server.mailer.sent.at(-1)!.to, "other@example.com")
    }))

  it.effect("to a class nobody watches any more: looks it up again, since what was recorded is old", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.unsubscribe({ params: INTRO_TO_CS })

      server.university.classes.set("202702/33940", { title: TITLE, seats: { enrolled: 10, capacity: 60 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })

      assert.strictEqual(server.university.calls.length, 4)
      assert.deepStrictEqual(yield* classRow(server, "202702", "33940"), { title: TITLE, vacant: 1 })
    }))

  it.effect("again: AlreadySubscribed, without asking the university or sending another email", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const calls = server.university.calls.length
      const emails = server.mailer.sent.length

      const error = yield* Effect.flip(api.alerts.subscribe({ payload: INTRO_TO_CS }))
      assert.strictEqual(error._tag, "AlreadySubscribed")
      assert.strictEqual(server.university.calls.length, calls)
      assert.strictEqual(server.mailer.sent.length, emails)
    }))

  it.effect("to the same CRN in another term: a separate alert", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.classes.set("202703/33940", { title: "WEB DEVELOPMENT", seats: { enrolled: 0, capacity: 30 } })
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      yield* api.alerts.subscribe({ payload: { term: "202703", crn: "33940" } })
      assert.deepStrictEqual(yield* api.alerts.list(), [
        { ...INTRO_TO_CS, title: TITLE },
        { term: "202703", crn: "33940", title: "WEB DEVELOPMENT" }
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

  it.effect("while the university is down: UniversityUnavailable, and nothing is stored", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.university.down = true
      const error = yield* Effect.flip(api.alerts.subscribe({ payload: INTRO_TO_CS }))
      assert.strictEqual(error._tag, "UniversityUnavailable")
      assert.deepStrictEqual(yield* api.alerts.list(), [])
    }))

  it.effect("when the confirmation cannot be sent: the alert stays, and the request succeeds", () =>
    Effect.gen(function*() {
      const { server, api } = yield* signedIn()
      server.mailer.failure = "Daily sending limit reached"
      const alert = yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      assert.deepStrictEqual(alert, { ...INTRO_TO_CS, title: TITLE })
      assert.deepStrictEqual(yield* api.alerts.list(), [alert])
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
