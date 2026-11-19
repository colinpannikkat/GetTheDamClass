import type { AppError } from "./domain"

/**
 * A sentence to show the user for each error. Components that want different
 * wording for one case can check `error._tag` first and fall back to this.
 */
export function errorMessage(error: AppError): string {
  // No `default` branch on purpose: when someone adds an error to `AppError`,
  // TypeScript reports this function until it has a sentence for it.
  switch (error._tag) {
    case "WrongPin":
      return "That PIN doesn't match this email. Check it and try again."
    case "ClassNotFound":
      return `We couldn't find a class with CRN ${error.crn}.`
    case "RequestRejected":
      return error.message
    case "NetworkError":
      return "Couldn't reach the server. Check your connection and try again."
    case "ServerError":
      return "The server had a problem. Please try again in a moment."
    case "NotSignedIn":
      return "Sign in to get alerts."
    case "StorageError":
      return "Couldn't read your saved sign-in. Reload the page and try again."
    case "UnexpectedError":
      return "Something went wrong. Please try again."
  }
}
