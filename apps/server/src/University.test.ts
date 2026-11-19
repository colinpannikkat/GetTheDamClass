import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isVacant, University } from "./University"

// The real University on top of a fake `fetch`: no request leaves the test.
// The pages it answers with are real ones, saved from the university in
// November 2026 (test/fixtures/): class CRN 33940 of term 202702, CRN 99999,
// which does not exist, and the term list. Variants of them (other dates, say)
// are made by changing a copy in the test.

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "test", "fixtures", name), "utf8")
const classDetails = fixture("getClassDetails.202702.33940.html")
const enrollment = fixture("getEnrollmentInfo.202702.33940.html")
const missingDetails = fixture("getClassDetails.202702.99999-missing.html")
const missingEnrollment = fixture("getEnrollmentInfo.202702.99999-missing.html")
const meetingTimes = fixture("getFacultyMeetingTimes.202702.33940.json")
const terms = fixture("getTerms.json")

/** The saved meeting times answer, with its one meeting time replaced by these dates. */
const meetingTimesWith = (dates: Array<{ startDate: string | null; endDate: string | null }>) => {
  const answer = JSON.parse(meetingTimes)
  const [entry] = answer.fmt
  answer.fmt = dates.map((date) => ({ ...entry, meetingTime: { ...entry.meetingTime, ...date } }))
  return JSON.stringify(answer)
}

interface RecordedRequest {
  readonly url: string
  readonly method: string | undefined
  readonly body: string
}

/** A University whose `fetch` answers every request with `respond()`, and the requests it received. */
const universityAnswering = (respond: () => Promise<Response>) => {
  const requests: Array<RecordedRequest> = []
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: String(init?.body) })
    return respond()
  }
  const layer = University.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  )
  return { requests, layer }
}

const page = (html: string, status = 200) => () => Promise.resolve(new Response(html, { status }))

/** Run one University call against a fake that always gives the same answer. */
const ask = <A, E>(respond: () => Promise<Response>, call: (university: University["Service"]) => Effect.Effect<A, E>) =>
  University.use(call).pipe(Effect.provide(universityAnswering(respond).layer))

describe("classTitle", () => {
  it.effect("posts the term and CRN as a form to getClassDetails", () =>
    Effect.gen(function*() {
      const fake = universityAnswering(page(classDetails))
      yield* University.use((university) => university.classTitle("202702", "33940")).pipe(Effect.provide(fake.layer))
      assert.deepStrictEqual(fake.requests, [{
        url: "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb/searchResults/getClassDetails",
        method: "POST",
        body: "term=202702&courseReferenceNumber=33940"
      }])
    }))

  it.effect("reads the course title from the page", () =>
    Effect.gen(function*() {
      const title = yield* ask(page(classDetails), (university) => university.classTitle("202702", "33940"))
      assert.strictEqual(title, "INTRO TO COMPUTER SCIENCE I")
    }))

  it.effect("turns HTML entities in the title back into characters", () =>
    Effect.gen(function*() {
      const html = classDetails.replace("INTRO TO COMPUTER SCIENCE I", "C &amp; C++ &#39;ADVANCED&#x27;")
      const title = yield* ask(page(html), (university) => university.classTitle("202702", "33940"))
      assert.strictEqual(title, "C & C++ 'ADVANCED'")
    }))

  it.effect("a page without a title (the university changed its layout): UniversityUnavailable", () =>
    Effect.gen(function*() {
      const html = classDetails.replace(/<span id="courseTitle">[^<]*<\/span>/, "")
      const error = yield* Effect.flip(ask(page(html), (university) => university.classTitle("202702", "33940")))
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))
})

describe("seats", () => {
  it.effect("posts the term and CRN as a form to getEnrollmentInfo", () =>
    Effect.gen(function*() {
      const fake = universityAnswering(page(enrollment))
      yield* University.use((university) => university.seats("202702", "33940")).pipe(Effect.provide(fake.layer))
      assert.strictEqual(
        fake.requests[0]!.url,
        "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb/searchResults/getEnrollmentInfo"
      )
      assert.strictEqual(fake.requests[0]!.body, "term=202702&courseReferenceNumber=33940")
    }))

  it.effect("reads how many are enrolled and how many fit", () =>
    Effect.gen(function*() {
      const seats = yield* ask(page(enrollment), (university) => university.seats("202702", "33940"))
      assert.deepStrictEqual(seats, { enrolled: 0, capacity: 60 })
    }))

  it.effect("a page without the counts: UniversityUnavailable", () =>
    Effect.gen(function*() {
      const html = enrollment.replace("Enrollment Maximum:", "Seats:")
      const error = yield* Effect.flip(ask(page(html), (university) => university.seats("202702", "33940")))
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))
})

describe("meetingDates", () => {
  it.effect("asks getFacultyMeetingTimes for the term and CRN", () =>
    Effect.gen(function*() {
      const fake = universityAnswering(page(meetingTimes))
      yield* University.use((university) => university.meetingDates("202702", "33940")).pipe(Effect.provide(fake.layer))
      assert.strictEqual(
        fake.requests[0]!.url,
        "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb/searchResults/getFacultyMeetingTimes?term=202702&courseReferenceNumber=33940"
      )
      assert.strictEqual(fake.requests[0]!.method, "GET")
    }))

  it.effect("reads the first and last day, as ISO dates", () =>
    Effect.gen(function*() {
      const dates = yield* ask(page(meetingTimes), (university) => university.meetingDates("202702", "33940"))
      assert.deepStrictEqual(dates, { starts: ["2027-01-04"], ends: ["2027-03-12"] })
    }))

  it.effect("reads every start and every end, also of a meeting time that has only one of them", () =>
    Effect.gen(function*() {
      const answer = meetingTimesWith([
        { startDate: "01/04/2027", endDate: "03/12/2027" },
        { startDate: null, endDate: null },
        { startDate: "01/06/2027", endDate: null },
        { startDate: null, endDate: "03/19/2027" }
      ])
      const dates = yield* ask(page(answer), (university) => university.meetingDates("202702", "33940"))
      assert.deepStrictEqual(dates, { starts: ["2027-01-04", "2027-01-06"], ends: ["2027-03-12", "2027-03-19"] })
    }))

  it.effect("a class without dates: none", () =>
    Effect.gen(function*() {
      const answer = meetingTimesWith([{ startDate: null, endDate: null }])
      const dates = yield* ask(page(answer), (university) => university.meetingDates("202702", "33940"))
      assert.deepStrictEqual(dates, { starts: [], ends: [] })
    }))

  it.effect.each([
    { title: "a date written another way", answer: meetingTimesWith([{ startDate: "2027-01-04", endDate: "03/12/2027" }]) },
    { title: "a month that does not exist", answer: meetingTimesWith([{ startDate: "13/04/2027", endDate: "03/12/2027" }]) },
    { title: "a day the month does not have", answer: meetingTimesWith([{ startDate: "01/04/2027", endDate: "02/30/2027" }]) },
    { title: "not JSON at all", answer: "<html>Service Unavailable</html>" }
  ])("an answer it cannot read ($title): UniversityUnavailable", ({ answer }) =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(ask(page(answer), (university) => university.meetingDates("202702", "33940")))
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))
})

describe("terms", () => {
  it.effect("asks getTerms for the newest 20", () =>
    Effect.gen(function*() {
      const fake = universityAnswering(page(terms))
      yield* University.use((university) => university.terms()).pipe(Effect.provide(fake.layer))
      assert.strictEqual(
        fake.requests[0]!.url,
        "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=20"
      )
      assert.strictEqual(fake.requests[0]!.method, "GET")
    }))

  it.effect("reads each term's code and name, and \"View Only\" as not open", () =>
    Effect.gen(function*() {
      const listed = yield* ask(page(terms), (university) => university.terms())
      assert.strictEqual(listed.length, 20)
      assert.deepStrictEqual(listed.slice(0, 4), [
        { code: "202703", name: "Spring 2027", open: false },
        { code: "202702", name: "Winter 2027", open: true },
        { code: "202701", name: "Fall 2026", open: true },
        { code: "202700", name: "Summer 2026", open: false }
      ])
    }))

  it.effect.each([
    { title: "an empty list", answer: "[]" },
    { title: "every term \"View Only\"", answer: terms.replace(/"description": "(\w+ \d{4})"/g, `"description": "$1 (View Only)"`) }
  ])("a list without an open term ($title): UniversityUnavailable, since one is always open", ({ answer }) =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(ask(page(answer), (university) => university.terms()))
      assert.strictEqual(error._tag, "UniversityUnavailable")
      assert.match(error.message, /try again/)
    }))

  it.effect("an error page: UniversityUnavailable", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(ask(page(missingDetails, 500), (university) => university.terms()))
      assert.strictEqual(error._tag, "UniversityUnavailable")
      assert.match(error.message, /try again/)
    }))
})

describe("isVacant", () => {
  it("is true while fewer students are enrolled than fit, and false once it is full", () => {
    assert.isTrue(isVacant({ enrolled: 59, capacity: 60 }))
    assert.isFalse(isVacant({ enrolled: 60, capacity: 60 }))
    // A class can be over capacity when the department lets students in by hand.
    assert.isFalse(isVacant({ enrolled: 61, capacity: 60 }))
  })
})

// "No such class" and "the university is having trouble" both come back as
// HTTP 500. The only difference in what the university sends is the error
// message inside its error page: for a CRN that does not exist, it says the
// section it tried to show was `null` (see `isMissingClassPage` in
// University.ts). So these tests start from the real page for CRN 99999 and
// change only that message.
describe("telling a missing class from an outage", () => {
  it.effect.each([
    {
      name: "getClassDetails",
      html: missingDetails,
      call: (university: University["Service"]) => Effect.asVoid(university.classTitle("202702", "99999"))
    },
    {
      name: "getEnrollmentInfo",
      html: missingEnrollment,
      call: (university: University["Service"]) => Effect.asVoid(university.seats("202702", "99999"))
    }
  ])("$name for a CRN that does not exist (HTTP 500, section `null`): ClassNotFound, with a sentence", ({ call, html }) =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(ask(page(html, 500), call))
      assert.strictEqual(error._tag, "ClassNotFound")
      assert.match(error.message, /CRN 99999/)
    }))

  it.effect("the same error page with any other message: UniversityUnavailable", () =>
    Effect.gen(function*() {
      const html = missingDetails.replace(
        /<meta name="errorMessage" content="[^"]*"\/>/,
        `<meta name="errorMessage" content="Unable to acquire JDBC Connection"/>`
      )
      const error = yield* Effect.flip(ask(page(html, 500), (university) => university.classTitle("202702", "99999")))
      assert.strictEqual(error._tag, "UniversityUnavailable")
      assert.match(error.message, /try again/)
    }))

  it.effect("the missing-class page with another status than 500: UniversityUnavailable", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        ask(page(missingDetails, 503), (university) => university.classTitle("202702", "99999"))
      )
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))

  it.effect("no answer at all (network down): UniversityUnavailable", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        ask(() => Promise.reject(new TypeError("fetch failed")), (university) => university.classTitle("202702", "33940"))
      )
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))

  it.effect("no answer within 10 seconds: UniversityUnavailable", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Effect.flip(ask(() => new Promise<Response>(() => {}), (university) => university.classTitle("202702", "33940")))
      )
      yield* TestClock.adjust("10 seconds")
      const error = yield* Fiber.join(fiber)
      assert.strictEqual(error._tag, "UniversityUnavailable")
    }))
})
