/**
 * The university's class search (Ellucian Banner), as an Effect service.
 *
 * Four of its answers are enough, none of them needing cookies:
 *
 * - `getClassDetails`: whether the class exists, and its title.
 * - `getEnrollmentInfo`: how many students are enrolled, and how many fit.
 * - `getFacultyMeetingTimes`: the dates the class meets, for its add deadline.
 * - `getTerms`: the terms the class search offers, and which are open.
 *
 * The first two are asked for with a form POST of the term and the CRN, and
 * answer with a fragment of HTML; the other two are GET requests that answer
 * with JSON. Reading those answers is done here too, so a change on the
 * university's side is fixed in this one file. Real answers are saved in
 * test/fixtures/ and University.test.ts reads them.
 */
import { ClassNotFound, type Crn, type Term, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

const BASE_URL = "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb"

/**
 * How long one request may take before we call the university unavailable.
 * It also keeps one slow class from holding up the check every minute.
 */
const REQUEST_TIMEOUT = "10 seconds"

/** Seats in a class, as the enrollment page counts them. */
export interface Seats {
  readonly enrolled: number
  readonly capacity: number
}

/** A class has a free seat when fewer students are enrolled than it allows. */
export const isVacant = (seats: Seats): boolean => seats.enrolled < seats.capacity

/**
 * The days a class's meeting times start and end, as ISO dates ("2027-01-04").
 * A class can have several meeting times (a lecture and a lab, say), and one
 * can lack either date, so the two lists need not pair up. Both are empty for
 * a class without dates.
 */
export interface MeetingDates {
  readonly starts: ReadonlyArray<string>
  readonly ends: ReadonlyArray<string>
}

/** A term as the class search lists it. */
export interface ListedTerm {
  readonly code: Term
  /** What people call it: "Winter 2027". */
  readonly name: string
  /**
   * False for a term the class search marks "View Only": one whose
   * registration has not opened yet, or one that is over.
   */
  readonly open: boolean
}

type LookupError = ClassNotFound | UniversityUnavailable

export class University extends Context.Service<University, {
  /** The course title of a class: "INTRO TO COMPUTER SCIENCE I". */
  classTitle(term: Term, crn: Crn): Effect.Effect<string, LookupError>
  /** How full a class is right now. */
  seats(term: Term, crn: Crn): Effect.Effect<Seats, LookupError>
  /** The dates a class meets. Both lists are empty for a class without dates. */
  meetingDates(term: Term, crn: Crn): Effect.Effect<MeetingDates, UniversityUnavailable>
  /**
   * The newest terms the class search offers, newest first. At least one of
   * them is open: an answer without one fails as `UniversityUnavailable`.
   */
  terms(): Effect.Effect<ReadonlyArray<ListedTerm>, UniversityUnavailable>
}>()("getthedamclass/University") {
  /** The real implementation, on whatever `HttpClient` is provided (`fetch` in the Worker). */
  static readonly layer = Layer.effect(
    University,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      /** Send one request, and read the answer as text, whatever its status. */
      const send = Effect.fn("University.send")(function*(name: string, request: HttpClientRequest.HttpClientRequest) {
        return yield* client.execute(request).pipe(
          Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.catch((cause) => unavailable(`${name}: no answer (${String(cause)})`))
        )
      })

      /** One page about a class, as text. Fails unless the university answered with the page itself. */
      const page = Effect.fn("University.page")(function*(name: string, term: Term, crn: Crn) {
        const request = HttpClientRequest.post(`${BASE_URL}/searchResults/${name}`).pipe(
          HttpClientRequest.bodyUrlParams({ term, courseReferenceNumber: crn })
        )
        const { status, body } = yield* send(name, request)
        if (status === 200) {
          return body
        }
        if (status === 500 && isMissingClassPage(body)) {
          return yield* new ClassNotFound({ message: `We couldn't find a class with CRN ${crn} in that term.` })
        }
        return yield* unavailable(`${name}: HTTP ${status}`)
      })

      /** One JSON answer, checked against `schema`. */
      const json = Effect.fn("University.json")(
        function*<S extends Schema.Top>(name: string, path: string, params: Record<string, string>, schema: S) {
          const request = HttpClientRequest.get(`${BASE_URL}/${path}`).pipe(HttpClientRequest.setUrlParams(params))
          const { status, body } = yield* send(name, request)
          if (status !== 200) {
            return yield* unavailable(`${name}: HTTP ${status}`)
          }
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
            Effect.catch((error) => unavailable(`${name}: unexpected answer (${error.message})`))
          )
        }
      )

      return {
        classTitle: (term, crn) =>
          page("getClassDetails", term, crn).pipe(
            Effect.flatMap((html) => {
              const title = readTitle(html)
              return title === undefined ? unavailable("getClassDetails: no course title on the page") : Effect.succeed(title)
            })
          ),
        seats: (term, crn) =>
          page("getEnrollmentInfo", term, crn).pipe(
            Effect.flatMap((html) => {
              const seats = readSeats(html)
              return seats === undefined ? unavailable("getEnrollmentInfo: no seat counts on the page") : Effect.succeed(seats)
            })
          ),
        meetingDates: (term, crn) =>
          json(
            "getFacultyMeetingTimes",
            "searchResults/getFacultyMeetingTimes",
            { term, courseReferenceNumber: crn },
            MeetingTimesAnswer
          ).pipe(Effect.map(readMeetingDates)),
        terms: () =>
          json("getTerms", "classSearch/getTerms", { searchTerm: "", offset: "1", max: "20" }, TermsAnswer).pipe(
            Effect.map((terms) => terms.map(readTerm)),
            // Some term is always open: in November 2026 both the one in
            // progress and the next were. So a list without one (an empty
            // one too) is a broken answer, and taken at its word it would
            // refuse every subscribe and end alerts that should go on.
            Effect.flatMap((terms) =>
              terms.some((term) => term.open) ? Effect.succeed(terms) : unavailable("getTerms: no open term in the list")
            )
          )
      }
    })
  )
}

/**
 * Fail with `UniversityUnavailable`, after logging the technical reason for
 * whoever reads the logs. The student gets a sentence instead. This line is
 * the one record of why, so callers need not log the failure again.
 */
const unavailable = (reason: string) =>
  Effect.logWarning("The university's class search failed", reason).pipe(
    Effect.andThen(
      Effect.fail(
        new UniversityUnavailable({
          message: "Oregon State's class search isn't answering right now. Please try again in a few minutes."
        })
      )
    )
  )

// ---------------------------------------------------------------------------
// Reading the pages
// ---------------------------------------------------------------------------

/**
 * Whether an HTTP 500 page is Banner's way of saying "no such class".
 *
 * Banner has no "not found" answer. Asked for a CRN that does not exist, it
 * fails while building the page and sends its generic error page, HTTP 500,
 * the same status as any real outage. What differs is the error message in
 * that page: it says the section it tried to show was `null` ("Cannot resolve
 * which method to invoke for [null]" in `SectionDecorator`).
 *
 * So only that exact failure counts as "no such class", and every other 500
 * as the university having trouble. If Banner ever changes the wording, a
 * missing class shows as "try again later": wrong, but harmless. The other
 * way round would tell students during an outage that their class does not
 * exist.
 */
const isMissingClassPage = (html: string): boolean => {
  const message = /<meta name="errorMessage" content="([^"]*)"/.exec(html)?.[1]
  return message !== undefined && message.includes("SectionDecorator") && message.includes("[null]")
}

/** The title in `<span id="courseTitle">INTRO TO COMPUTER SCIENCE I</span>`. */
const readTitle = (html: string): string | undefined => {
  const title = /<span id="courseTitle">([^<]*)<\/span>/.exec(html)?.[1]
  return title === undefined || title.trim() === "" ? undefined : decodeEntities(title.trim())
}

/**
 * The two numbers after "Enrollment Actual:" and "Enrollment Maximum:". Each
 * sits in the `<span>` that follows its label, with line breaks around.
 */
const readSeats = (html: string): Seats | undefined => {
  const count = (label: string) => {
    const match = new RegExp(`${label}:</span>\\s*<span[^>]*>\\s*(\\d+)\\s*</span>`).exec(html)
    return match === null ? undefined : Number(match[1])
  }
  const enrolled = count("Enrollment Actual")
  const capacity = count("Enrollment Maximum")
  return enrolled === undefined || capacity === undefined ? undefined : { enrolled, capacity }
}

/**
 * A date as Banner writes it: "01/04/2027" (month, day, year), of a day that
 * exists. Without the second check "02/30/2027" would pass, and later count
 * as March 2.
 */
const BannerDate = Schema.String.check(
  Schema.isPattern(/^\d{2}\/\d{2}\/\d{4}$/),
  Schema.makeFilter((date) => isCalendarDay(isoDate(date)))
)

/**
 * What `getFacultyMeetingTimes` answers, reduced to the part we read: one
 * entry per meeting time. A date not known yet (a meeting time still "to be
 * announced") is `null`, and a meeting time can have one date without the
 * other.
 */
const MeetingTimesAnswer = Schema.Struct({
  fmt: Schema.Array(Schema.Struct({
    meetingTime: Schema.Struct({ startDate: Schema.NullOr(BannerDate), endDate: Schema.NullOr(BannerDate) })
  }))
})

/** Every start date and every end date the meeting times have, as ISO dates. */
const readMeetingDates = (answer: typeof MeetingTimesAnswer.Type): MeetingDates => {
  const times = answer.fmt.map((entry) => entry.meetingTime)
  return {
    starts: times.flatMap(({ startDate }) => startDate === null ? [] : [isoDate(startDate)]),
    ends: times.flatMap(({ endDate }) => endDate === null ? [] : [isoDate(endDate)])
  }
}

/** "01/04/2027" as "2027-01-04". */
const isoDate = (bannerDate: string): string => {
  const [month, day, year] = bannerDate.split("/")
  return `${year}-${month}-${day}`
}

/**
 * Whether an ISO date names a day that exists. JavaScript reads "2027-13-04"
 * as no date at all, and "2027-02-30" as March 2, which the round trip shows.
 */
const isCalendarDay = (iso: string): boolean => {
  const time = Date.parse(iso)
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(iso)
}

/** What `getTerms` answers: `[{ "code": "202702", "description": "Winter 2027" }, ...]`. */
const TermsAnswer = Schema.Array(Schema.Struct({ code: Schema.String, description: Schema.String }))

/**
 * A term from its description. A term students cannot register for is
 * described with " (View Only)" after its name: "Spring 2027 (View Only)".
 */
const readTerm = ({ code, description }: typeof TermsAnswer.Type[number]): ListedTerm => {
  const name = description.replace(/\s*\(View Only\)\s*$/, "")
  return { code, name, open: name === description }
}

const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }

/** Turn `&amp;`, `&#39;` and the like back into the characters they stand for. */
const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(parseInt(name.slice(2), 16))
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number(name.slice(1)))
    }
    return namedEntities[name.toLowerCase()] ?? entity
  })
