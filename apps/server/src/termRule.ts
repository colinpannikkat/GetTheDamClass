// Dates are ISO strings ("2027-01-17"), which sort like the dates they name, so SQL can compare them with `<`.
import {
  AddDeadlinePassed,
  type Crn,
  type Term,
  TermNotOpen,
  type UniversityUnavailable
} from "@getthedamclass/shared/domain"
import { DateTime, Duration, Effect } from "effect"
import { classLabel } from "./html"
import { type MeetingDates, University } from "./University"

const OREGON = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles")

export const todayInOregon: Effect.Effect<string> = Effect.map(
  DateTime.now,
  (now) => DateTime.formatIsoDate(DateTime.setZone(now, OREGON))
)

// Weeks are 7-day blocks from the first day, a partly used last block counting whole: Monday to Friday
// of the sixth week (40 days) is a six-week session.
const SHORT_SESSION_WEEKS = 6

// The owner's rule, after OSU's add deadlines: the Sunday ending the second week from the first Monday
// on or after the earliest start, or the first week if the class runs under six weeks.
export const addDeadline = (dates: MeetingDates): string | undefined => {
  const start = [...dates.starts].sort()[0]
  const end = [...dates.ends].sort().at(-1)
  if (start === undefined) {
    return undefined
  }
  const first = DateTime.makeUnsafe(start)
  const daysToMonday = (8 - DateTime.getPartUtc(first, "weekDay")) % 7
  const firstMonday = DateTime.add(first, { days: daysToMonday })
  // First and last day both count: Monday to Friday is five days, one week.
  const weeks = end === undefined
    ? Infinity
    : Math.ceil((Duration.toDays(DateTime.distance(first, DateTime.makeUnsafe(end))) + 1) / 7)
  return DateTime.formatIsoDateUtc(DateTime.add(firstMonday, { days: weeks < SHORT_SESSION_WEEKS ? 6 : 13 }))
}

export const addDeadlinePassed = (alert: { readonly title: string; readonly crn: Crn }, deadline: string) => {
  const day = DateTime.formatUtc(DateTime.makeUnsafe(deadline), { locale: "en-US", dateStyle: "full" })
  return new AddDeadlinePassed({
    message: `The last day to add ${classLabel(alert)} was ${day}, so seat alerts for it have ended.`
  })
}

export const requireOpenTerm = Effect.fn("requireOpenTerm")(
  function*(code: Term): Effect.fn.Return<void, TermNotOpen | UniversityUnavailable, University> {
    const university = yield* University
    const terms = yield* university.terms()
    const term = terms.find((listed) => listed.code === code)
    if (term === undefined) {
      return yield* new TermNotOpen({
        message: "Oregon State's class search doesn't offer that term, so it can't have seat alerts."
      })
    }
    if (term.open) {
      return
    }
    // Codes count up, so a "View Only" term newer than every open one has not opened yet, and any other is over.
    const openCodes = terms.filter((listed) => listed.open).map((listed) => listed.code)
    const upcoming = openCodes.every((open) => open < code)
    return yield* new TermNotOpen({
      message: upcoming
        ? `Seat alerts for ${term.name} start when registration opens.`
        : `Registration for ${term.name} has closed, so seat alerts for it have ended.`
    })
  }
)

// A term missing from the list is not taken as closed: a broken answer could leave out an open term.
export const closedTerms = Effect.fn("closedTerms")(function*() {
  const university = yield* University
  const terms = yield* university.terms()
  return terms.filter((term) => !term.open).map((term) => term.code)
})
