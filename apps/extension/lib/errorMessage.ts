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
      // There is no "reset PIN" on the server, so say who can help.
      return "That PIN doesn't match this email. Check it and try again. Forgot it? Email getthedamclass@gmail.com."
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

/** The sentence for a failed "Stop". Two cases need different words there. */
export function stopErrorMessage(error: AppError): string {
  switch (error._tag) {
    case "ClassNotFound":
      // The server only knows the classes of the current term, so it refuses
      // to touch an alert left over from an earlier one.
      return "This class isn't in the current term, so it can't be stopped here. Use the Unsubscribe button in the confirmation email you got for it."
    case "WrongPin":
      return "Your saved PIN no longer works. Sign out, then sign in again."
    default:
      return errorMessage(error)
  }
}
