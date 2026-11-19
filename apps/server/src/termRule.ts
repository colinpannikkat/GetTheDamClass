/**
 * The term rule: which classes take new alerts, and until when.
 *
 * A student can start alerts for a class only while both hold:
 *
 * 1. Its term is open: the university's class search lists the term, and not
 *    as "View Only". "View Only" marks both a term whose registration has not
 *    opened yet and a term that is over.
 * 2. Today, in Oregon (Pacific time), is on or before the class's add
 *    deadline (`addDeadline` below).
 *
 * The daily job (cleanup.ts) ends alerts by nearly the same rule, so a
 * student stops getting emails about a seat they could no longer take: after
 * the class's add deadline, or for a class without one, once its term is
 * listed as "View Only".
 *
 * Dates are kept as ISO dates ("2027-01-17"): days on the calendar, with no
 * time of day. Strings in that form sort like the dates they name, which is
 * what lets the SQL compare them with `<`.
 */
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

/** Oregon State's time zone, which decides when one day ends and the next begins. */
const OREGON = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles")

/** Today's date in Oregon, from Effect's clock (so tests can set it). */
export const todayInOregon: Effect.Effect<string> = Effect.map(
  DateTime.now,
  (now) => DateTime.formatIsoDate(DateTime.setZone(now, OREGON))
)

/**
 * A class that runs fewer weeks than this is a short session. Weeks are
 * counted in blocks of seven days from the class's first day, and a last
 * block the class only partly uses counts as a whole week. That is how a
 * session is named: one that runs Monday to Friday of its sixth week is a
 * six-week session (40 days), not "under six weeks".
 */
const SHORT_SESSION_WEEKS = 6

/**
 * The last day a class takes new alerts, as an ISO date, or `undefined` for a
 * class without a start date (which takes alerts for as long as its term is
 * open).
 *
 * The rule is the project owner's, and follows Oregon State's add deadlines:
 * a class can be added until the Sunday that ends its second week, or its
 * first week for a short session. Worked out from the class's own dates:
 *
 * - take the earliest start date among its meeting times;
 * - find the first Monday on or after it (the class's first full week);
 * - add 13 days, which lands on the Sunday ending the second week; or 6 days,
 *   the Sunday ending the first week, if the class runs under six weeks (from
 *   that earliest start date to the latest end date among its meeting times).
 *   A class with no end date at all is not taken for a short session.
 *
 * For example, a class from Monday 2027-01-04 to 2027-03-12 has the deadline
 * Sunday 2027-01-17.
 */
export const addDeadline = (dates: MeetingDates): string | undefined => {
  // ISO dates compare as strings in calendar order.
  const start = [...dates.starts].sort()[0]
  const end = [...dates.ends].sort().at(-1)
  if (start === undefined) {
    return undefined
  }
  const first = DateTime.makeUnsafe(start)
  // `weekDay` counts from Sunday (0) to Saturday (6).
  const daysToMonday = (8 - DateTime.getPartUtc(first, "weekDay")) % 7
  const firstMonday = DateTime.add(first, { days: daysToMonday })
  // First and last day both count: Monday to Friday is five days, one week.
  const weeks = end === undefined
    ? Infinity
    : Math.ceil((Duration.toDays(DateTime.distance(first, DateTime.makeUnsafe(end))) + 1) / 7)
  return DateTime.formatIsoDateUtc(DateTime.add(firstMonday, { days: weeks < SHORT_SESSION_WEEKS ? 6 : 13 }))
}

/** A refusal naming the day alerts for the class ended: "Sunday, January 17, 2027". */
export const addDeadlinePassed = (alert: { readonly title: string; readonly crn: Crn }, deadline: string) => {
  const day = DateTime.formatUtc(DateTime.makeUnsafe(deadline), { locale: "en-US", dateStyle: "full" })
  return new AddDeadlinePassed({
    message: `The last day to add ${classLabel(alert)} was ${day}, so seat alerts for it have ended.`
  })
}

/**
 * Succeed if the term is open, and fail with a sentence saying why not
 * otherwise. Asks the university for its term list every time.
 */
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
    // Both kinds of closed term say "View Only"; their codes tell them apart.
    // Codes count up (the year, then the term), so a term newer than every
    // open one has not opened yet, and any other is over. (The list always
    // has an open term; `University.terms` fails otherwise.)
    const openCodes = terms.filter((listed) => listed.open).map((listed) => listed.code)
    const upcoming = openCodes.every((open) => open < code)
    return yield* new TermNotOpen({
      message: upcoming
        ? `Seat alerts for ${term.name} start when registration opens.`
        : `Registration for ${term.name} has closed, so seat alerts for it have ended.`
    })
  }
)

/**
 * The codes of the terms the class search lists as "View Only": over, or not
 * open yet. A term the list leaves out is not one of them, since a broken
 * answer could leave out an open term. That keeps nothing for good: the list
 * holds the newest 20 terms, some five years' worth, so a term is listed as
 * "View Only" for years before it drops off.
 */
export const closedTerms = Effect.fn("closedTerms")(function*() {
  const university = yield* University
  const terms = yield* university.terms()
  return terms.filter((term) => !term.open).map((term) => term.code)
})
