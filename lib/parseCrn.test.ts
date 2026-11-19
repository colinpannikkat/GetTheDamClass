import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { parseCrn } from "./parseCrn"

describe("parseCrn", () => {
  it("finds the CRN in the class page's section line", () => {
    expect(parseCrn("Section 001, CRN 39835")).toEqual(Option.some("39835"))
  })

  it("copes with different spacing, punctuation and letter case", () => {
    expect(parseCrn("CRN: 12345")).toEqual(Option.some("12345"))
    expect(parseCrn("crn 12345")).toEqual(Option.some("12345"))
    expect(parseCrn("Section 400\n  CRN  71234  ")).toEqual(Option.some("71234"))
  })

  it("keeps leading zeros, because a CRN is text and not a number", () => {
    expect(parseCrn("Section 001, CRN 01234")).toEqual(Option.some("01234"))
  })

  it("returns none when there is no CRN", () => {
    expect(parseCrn("")).toEqual(Option.none())
    expect(parseCrn("Section 001")).toEqual(Option.none())
    expect(parseCrn("CRN unknown")).toEqual(Option.none())
    expect(parseCrn("39835")).toEqual(Option.none())
  })
})
