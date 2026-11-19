import { Option } from "effect"
import type { Crn } from "./domain"

/**
 * Find the CRN in text taken from the class page.
 *
 *   parseCrn("Section 001, CRN 39835")  // Option.some("39835")
 *   parseCrn("Section 001")             // Option.none()
 */
export const parseCrn = (text: string): Option.Option<Crn> =>
  // "CRN", then up to three characters that are not digits (a space, ": "),
  // then the digits we want.
  Option.fromNullishOr(text.match(/\bCRN\D{0,3}(\d+)/i)?.[1])
