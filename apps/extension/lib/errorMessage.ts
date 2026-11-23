import type { AppError } from "./domain"

export function errorMessage(error: AppError): string {
  // No `default` on purpose: TypeScript flags a new `AppError` here until it has a sentence.
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
