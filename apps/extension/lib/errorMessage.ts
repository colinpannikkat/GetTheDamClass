import type { AppError } from "./domain"

/**
 * A sentence to show the user for each error.
 *
 * The server's refusals carry their own sentence, written for the student,
 * and it is shown as it is. Only the extension's own errors need words from
 * here.
 */
export function errorMessage(error: AppError): string {
  // No `default` branch on purpose: when someone adds an error to `AppError`,
  // TypeScript reports this function until it has a sentence for it.
  switch (error._tag) {
    case "NotSignedIn":
    case "CodeRecentlySent":
    case "EmailNotSent":
    case "InvalidCode":
    case "ClassNotFound":
    case "TermNotOpen":
    case "AddDeadlinePassed":
    case "UniversityUnavailable":
      return error.message
    case "NetworkError":
      return "Couldn't reach the server. Check your connection and try again."
    case "ServerError":
      return "The server had a problem. Please try again in a moment."
    case "StorageError":
      return "Couldn't read your saved sign-in. Reload the page and try again."
    case "UnexpectedError":
      return "Something went wrong. Please try again."
  }
}
