/**
 * The university's class search (Ellucian Banner), as an Effect service.
 *
 * Two of its pages are enough, both asked for with a form POST of the term
 * and the CRN, no cookies needed:
 *
 * - `getClassDetails`: whether the class exists, and its title.
 * - `getEnrollmentInfo`: how many students are enrolled, and how many fit.
 *
 * Both answer with a fragment of HTML. Reading those fragments is done here
 * too, so a change on the university's side is fixed in this one file. Real
 * answers are saved in test/fixtures/ and University.test.ts reads them.
 */
import { ClassNotFound, type Crn, type Term, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

const BASE_URL = "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb/searchResults"

/** How long one page may take before we call the university unavailable. */
const REQUEST_TIMEOUT = "10 seconds"

/** Seats in a class, as the enrollment page counts them. */
export interface Seats {
  readonly enrolled: number
  readonly capacity: number
}

/** A class has a free seat when fewer students are enrolled than it allows. */
export const isVacant = (seats: Seats): boolean => seats.enrolled < seats.capacity

type LookupError = ClassNotFound | UniversityUnavailable

export class University extends Context.Service<University, {
  /** The course title of a class: "INTRO TO COMPUTER SCIENCE I". */
  classTitle(term: Term, crn: Crn): Effect.Effect<string, LookupError>
  /** How full a class is right now. */
  seats(term: Term, crn: Crn): Effect.Effect<Seats, LookupError>
}>()("getthedamclass/University") {
  /** The real implementation, on whatever `HttpClient` is provided (`fetch` in the Worker). */
  static readonly layer = Layer.effect(
    University,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      /** One page, as text. Fails unless the university answered with the page itself. */
      const page = Effect.fn("University.page")(function*(name: string, term: Term, crn: Crn) {
        const request = HttpClientRequest.post(`${BASE_URL}/${name}`).pipe(
          HttpClientRequest.bodyUrlParams({ term, courseReferenceNumber: crn })
        )
        const { status, body } = yield* client.execute(request).pipe(
          Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.catch((cause) => unavailable(`${name}: no answer (${String(cause)})`))
        )
        if (status === 200) {
          return body
        }
        if (status === 500 && isMissingClassPage(body)) {
          return yield* new ClassNotFound({ message: `We couldn't find a class with CRN ${crn} in that term.` })
        }
        return yield* unavailable(`${name}: HTTP ${status}`)
      })

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
          )
      }
    })
  )
}

/**
 * Fail with `UniversityUnavailable`, after logging the technical reason for
 * whoever reads the logs. The student gets a sentence instead.
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
