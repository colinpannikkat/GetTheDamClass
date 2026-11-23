import type { Crn } from "@getthedamclass/shared/domain"

export const ACCENT = "#D73F09"

export const classLabel = (alert: { readonly title: string; readonly crn: Crn }) => `${alert.title} (CRN ${alert.crn})`

const replacements: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => replacements[char]!)
