/**
 * A term's code in words, for the popup's list: "202702" is "Winter 2027".
 *
 * The university's codes are the academic year (named after the calendar
 * year it ends in) followed by the term within it. The academic year starts
 * with the summer and fall of the calendar year before:
 *
 *   202700  Summer 2026      202702  Winter 2027
 *   202701  Fall 2026        202703  Spring 2027
 *
 * (The class search's own term list, saved in
 * apps/server/test/fixtures/getTerms.json, names them the same way.)
 */
import type { Term } from "@getthedamclass/shared/domain"
import { Option } from "effect"

/** The four terms of an academic year, by their last two digits, and whether they fall in the calendar year before. */
const TERMS: Record<string, { readonly season: string; readonly yearBefore: boolean }> = {
  "00": { season: "Summer", yearBefore: true },
  "01": { season: "Fall", yearBefore: true },
  "02": { season: "Winter", yearBefore: false },
  "03": { season: "Spring", yearBefore: false }
}

/** The term in words, or `Option.none()` for a code that does not follow the scheme. */
export const termName = (code: Term): Option.Option<string> => {
  const [, year, term] = code.match(/^(\d{4})(0[0-3])$/) ?? []
  if (year === undefined || term === undefined) {
    return Option.none()
  }
  const { season, yearBefore } = TERMS[term]!
  return Option.some(`${season} ${yearBefore ? Number(year) - 1 : year}`)
}
