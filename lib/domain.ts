/**
 * The vocabulary of the extension: the data we pass around and every error
 * that can happen. Nothing in this file talks to the network or to storage.
 */
import { Data, Schema } from "effect"

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// A convention you will see below: a schema and its type share one name.
// `Crn` the value checks data at runtime; `Crn` the type is what TypeScript
// sees. Which one is meant is always clear from where it is used.

/**
 * A Course Reference Number: the digits OSU uses to identify one class
 * section, for example "39835". Always kept as a string of digits.
 */
export const Crn = Schema.String.check(Schema.isPattern(/^\d+$/))
export type Crn = typeof Crn.Type

/**
 * What identifies a user to the backend. There are no sessions or tokens: the
 * email and PIN are sent with every request. The rules match the backend's
 * (an email contains "@", a PIN is exactly 4 digits).
 */
export const Credentials = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/@/)),
  pin: Schema.String.check(Schema.isPattern(/^\d{4}$/))
})
export type Credentials = typeof Credentials.Type

/** One class the user wants vacancy alerts for. */
export interface Subscription {
  readonly crn: Crn
  /** The course title, or `null` when the server could not look it up. */
  readonly name: string | null
}

/** The text to show for a subscription: its name, or "CRN 39835" without one. */
export const subscriptionLabel = (subscription: Subscription): string =>
  subscription.name ?? `CRN ${subscription.crn}`

/**
 * The same with the CRN always in it, "INTRO TO DEEP LEARNING (CRN 39835)",
 * for where two sections of one course must be told apart.
 */
export const subscriptionFullLabel = (subscription: Subscription): string =>
  subscription.name === null ? `CRN ${subscription.crn}` : `${subscription.name} (CRN ${subscription.crn})`

// ---------------------------------------------------------------------------
// Errors
//
// Each error is a small class with a `_tag` (its name as a string). Code that
// handles errors switches on `error._tag`, and TypeScript checks that no case
// is forgotten. `message` is the server's own explanation where there is one.
// ---------------------------------------------------------------------------

/**
 * The server rejected the email and PIN (HTTP 401). When signing in, the PIN is
 * wrong for an existing account. On any other call, the saved credentials no
 * longer work and the user has to sign in again.
 */
export class WrongPin extends Data.TaggedError("WrongPin")<{ readonly message: string }> {}

/** The user already gets alerts for this class (HTTP 409). */
export class AlreadySubscribed extends Data.TaggedError("AlreadySubscribed")<{ readonly crn: Crn }> {}

/** The server does not know a class with this CRN in the term it watches. */
export class ClassNotFound extends Data.TaggedError("ClassNotFound")<{ readonly crn: Crn }> {}

/** The user tried to unsubscribe from a class they are not subscribed to. */
export class NotSubscribed extends Data.TaggedError("NotSubscribed")<{ readonly crn: Crn }> {}

/**
 * The server refused the request for another reason (HTTP 400), such as an
 * invalid email. `message` says why.
 */
export class RequestRejected extends Data.TaggedError("RequestRejected")<{ readonly message: string }> {}

/**
 * No answer from the server: offline, DNS failure, blocked, or nothing came
 * back in time.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly cause: unknown }> {}

/**
 * The server answered with something we do not understand: an unexpected
 * status code, a body that is not JSON, or JSON of the wrong shape.
 */
export class ServerError extends Data.TaggedError("ServerError")<{
  readonly status: number
  readonly message: string
}> {}

/** An action needs saved credentials and there are none. */
export class NotSignedIn extends Data.TaggedError("NotSignedIn") {}

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
  | WrongPin
  | ClassNotFound
  | RequestRejected
  | NetworkError
  | ServerError
  | NotSignedIn
  | StorageError
  | UnexpectedError
