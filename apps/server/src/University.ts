import { ClassNotFound, type Crn, type Term, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

const BASE_URL = "https://prodapps.isadm.oregonstate.edu/StudentRegistrationSsb/ssb"

const REQUEST_TIMEOUT = "10 seconds"

export interface Seats {
  readonly enrolled: number
  readonly capacity: number
}

export const isVacant = (seats: Seats): boolean => seats.enrolled < seats.capacity

export interface MeetingDates {
  readonly starts: ReadonlyArray<string>
  readonly ends: ReadonlyArray<string>
}

export interface ListedTerm {
  readonly code: Term
  readonly name: string
  readonly open: boolean
}

type LookupError = ClassNotFound | UniversityUnavailable

export class University extends Context.Service<University, {
  classTitle(term: Term, crn: Crn): Effect.Effect<string, LookupError>
  seats(term: Term, crn: Crn): Effect.Effect<Seats, LookupError>
  meetingDates(term: Term, crn: Crn): Effect.Effect<MeetingDates, UniversityUnavailable>
  terms(): Effect.Effect<ReadonlyArray<ListedTerm>, UniversityUnavailable>
}>()("getthedamclass/University") {
  static readonly layer = Layer.effect(
    University,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      const send = Effect.fn("University.send")(function*(name: string, request: HttpClientRequest.HttpClientRequest) {
        return yield* client.execute(request).pipe(
          Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.catch((cause) => unavailable(`${name}: no answer (${String(cause)})`))
        )
      })

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
            // Some term is always open, so a list without one (even an empty one) is a broken answer.
            Effect.flatMap((terms) =>
              terms.some((term) => term.open) ? Effect.succeed(terms) : unavailable("getTerms: no open term in the list")
            )
          )
      }
    })
  )
}

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

// Banner has no "not found": a missing CRN gets the generic HTTP 500 page, whose message says the section
// was `null`. Only that exact failure is a missing class; any other 500 is the university having trouble.
const isMissingClassPage = (html: string): boolean => {
  const message = /<meta name="errorMessage" content="([^"]*)"/.exec(html)?.[1]
  return message !== undefined && message.includes("SectionDecorator") && message.includes("[null]")
}

const readTitle = (html: string): string | undefined => {
  const title = /<span id="courseTitle">([^<]*)<\/span>/.exec(html)?.[1]
  return title === undefined || title.trim() === "" ? undefined : decodeEntities(title.trim())
}

const readSeats = (html: string): Seats | undefined => {
  const count = (label: string) => {
    const match = new RegExp(`${label}:</span>\\s*<span[^>]*>\\s*(\\d+)\\s*</span>`).exec(html)
    return match === null ? undefined : Number(match[1])
  }
  const enrolled = count("Enrollment Actual")
  const capacity = count("Enrollment Maximum")
  return enrolled === undefined || capacity === undefined ? undefined : { enrolled, capacity }
}

const BannerDate = Schema.String.check(
  Schema.isPattern(/^\d{2}\/\d{2}\/\d{4}$/),
  Schema.makeFilter((date) => isCalendarDay(isoDate(date)))
)

const MeetingTimesAnswer = Schema.Struct({
  fmt: Schema.Array(Schema.Struct({
    meetingTime: Schema.Struct({ startDate: Schema.NullOr(BannerDate), endDate: Schema.NullOr(BannerDate) })
  }))
})

const readMeetingDates = (answer: typeof MeetingTimesAnswer.Type): MeetingDates => {
  const times = answer.fmt.map((entry) => entry.meetingTime)
  return {
    starts: times.flatMap(({ startDate }) => startDate === null ? [] : [isoDate(startDate)]),
    ends: times.flatMap(({ endDate }) => endDate === null ? [] : [isoDate(endDate)])
  }
}

const isoDate = (bannerDate: string): string => {
  const [month, day, year] = bannerDate.split("/")
  return `${year}-${month}-${day}`
}

// JavaScript reads "2027-02-30" as March 2; the round trip catches it.
const isCalendarDay = (iso: string): boolean => {
  const time = Date.parse(iso)
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(iso)
}

const TermsAnswer = Schema.Array(Schema.Struct({ code: Schema.String, description: Schema.String }))

const readTerm = ({ code, description }: typeof TermsAnswer.Type[number]): ListedTerm => {
  const name = description.replace(/\s*\(View Only\)\s*$/, "")
  return { code, name, open: name === description }
}

const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }

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
