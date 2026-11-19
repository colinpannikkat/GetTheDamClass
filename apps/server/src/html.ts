/**
 * Putting text into HTML safely, for the emails and the unsubscribe page.
 * Course titles come from the university and could contain `<` or `&`.
 */

const replacements: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}

/** `text` with every character that means something in HTML written as an entity. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => replacements[char]!)
