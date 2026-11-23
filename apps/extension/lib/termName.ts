// Codes are the academic year (named for the calendar year it ends in), then the term; its
// summer and fall fall in the calendar year before.
import type { Term } from "@getthedamclass/shared/domain"
import { Option } from "effect"

const TERMS: Record<string, { readonly season: string; readonly yearBefore: boolean }> = {
  "00": { season: "Summer", yearBefore: true },
  "01": { season: "Fall", yearBefore: true },
  "02": { season: "Winter", yearBefore: false },
  "03": { season: "Spring", yearBefore: false }
}

export const termName = (code: Term): Option.Option<string> => {
  const [, year, term] = code.match(/^(\d{4})(0[0-3])$/) ?? []
  if (year === undefined || term === undefined) {
    return Option.none()
  }
  const { season, yearBefore } = TERMS[term]!
  return Option.some(`${season} ${yearBefore ? Number(year) - 1 : year}`)
}
