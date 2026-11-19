/**
 * What the emails and the unsubscribe page have in common: putting text into
 * HTML safely, how a class is named for a person, and the brand colour.
 * Course titles come from the university and could contain `<` or `&`.
 */
import type { Crn } from "@getthedamclass/shared/domain"

/** Oregon State's orange, for the one accent line and the button. */
export const ACCENT = "#D73F09"

/**
 * A class as a person reads it: "INTRO TO COMPUTER SCIENCE I (CRN 33940)".
 * The CRN tells apart sections that share a title. This is plain text, not
 * HTML yet.
 */
export const classLabel = (alert: { readonly title: string; readonly crn: Crn }) => `${alert.title} (CRN ${alert.crn})`

const replacements: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}

/** `text` with every character that means something in HTML written as an entity. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => replacements[char]!)
