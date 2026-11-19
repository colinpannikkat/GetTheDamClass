import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { termName } from "./termName"

describe("termName", () => {
  // The codes and names of the class search's own term list (November 2026).
  it.each([
    ["202700", "Summer 2026"],
    ["202701", "Fall 2026"],
    ["202702", "Winter 2027"],
    ["202703", "Spring 2027"],
    ["202600", "Summer 2025"]
  ])("names %s %s", (code, name) => {
    assert.deepStrictEqual(termName(code), Option.some(name))
  })

  it.each(["202704", "202799", "20270", "2027020", "abcdef", ""])("names nothing for %j", (code) => {
    assert.deepStrictEqual(termName(code), Option.none())
  })
})
