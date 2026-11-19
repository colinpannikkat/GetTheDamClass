/**
 * The extension's own vocabulary, on top of the API's (packages/shared):
 * which class an alert is for, and the errors only the extension can have.
 * Nothing in this file talks to the network or to storage.
 *
 * The data the server sends (`Alert`, `Term`, `Crn`, `EmailAddress`) and the
 * server's refusals (`NotSignedIn`, `TermNotOpen`, ...) are defined once, in
 * `@getthedamclass/shared/domain`, and imported from there.
 */
import type {
  AddDeadlinePassed,
  Alert,
  ClassNotFound,
  CodeRecentlySent,
  Crn,
  EmailNotSent,
  InvalidCode,
  NotSignedIn,
  Term,
  TermNotOpen,
  UniversityUnavailable
} from "@getthedamclass/shared/domain"
import { Data, Option } from "effect"
import { termName } from "./termName"

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * Which class: a term and a CRN. The university reuses CRNs from term to
 * term, so the same CRN in two terms is two different classes, and a CRN is
 * never looked at without its term. (An `Alert` from the server is one too.)
 */
export interface ClassId {
  readonly term: Term
  readonly crn: Crn
}

/** Whether two values name the same class. */
export const sameClass = (a: ClassId, b: ClassId): boolean => a.term === b.term && a.crn === b.crn

/**
 * The text that tells one alert from every other: its title, CRN and term,
 * "INTRO TO DEEP LEARNING (CRN 39835, Winter 2027)". Two sections of one
 * course share a title, and one CRN can be in two terms.
 */
export const alertLabel = (alert: Alert): string =>
  Option.match(termName(alert.term), {
    onNone: () => `${alert.title} (CRN ${alert.crn})`,
    onSome: (term) => `${alert.title} (CRN ${alert.crn}, ${term})`
  })

// ---------------------------------------------------------------------------
// Errors
//
// Each error is a small class with a `_tag` (its name as a string). Code that
// handles errors switches on `error._tag`, and TypeScript checks that no case
// is forgotten. The server's refusals carry a `message` written for the
// student; the extension's own errors below do not, and `lib/errorMessage.ts`
// has a sentence for each.
// ---------------------------------------------------------------------------

/**
 * No answer from the server: offline, DNS failure, blocked by the browser,
 * or nothing came back in time.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly cause: unknown }> {}

/**
 * The server answered with something the API does not describe: a status it
 * does not list (a crash is HTTP 500), or a body of the wrong shape.
 */
export class ServerError extends Data.TaggedError("ServerError")<{ readonly cause: unknown }> {}

/** Reading from or writing to the browser's extension storage failed. */
export class StorageError extends Data.TaggedError("StorageError")<{ readonly cause: unknown }> {}

/**
 * A bug: something failed in a way no code path expected. The React bridge
 * (`lib/react.ts`) wraps such failures in this error so a component always has
 * something to show.
 */
export class UnexpectedError extends Data.TaggedError("UnexpectedError")<{ readonly cause: unknown }> {}

/**
 * Every error a user interface may have to show. (`AlreadySubscribed` and
 * `NotSubscribed` are missing on purpose: the workflows treat them as "done".)
 */
export type AppError =
  | NotSignedIn
  | CodeRecentlySent
  | EmailNotSent
  | InvalidCode
  | ClassNotFound
  | TermNotOpen
  | AddDeadlinePassed
  | UniversityUnavailable
  | NetworkError
  | ServerError
  | StorageError
  | UnexpectedError
