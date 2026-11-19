/**
 * The vocabulary of the extension: the data we pass around and every error
 * that can happen. Nothing in this file talks to the network or to storage.
 */
import { Schema } from "effect"

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

/** Signing in also creates the account when the email is new. */
export type SignInOutcome = "accountCreated" | "loggedIn"

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
export class WrongPin extends Schema.TaggedError<WrongPin>()("WrongPin", {
  message: Schema.String
}) {}

/** The user already gets alerts for this class (HTTP 409). */
export class AlreadySubscribed extends Schema.TaggedError<AlreadySubscribed>()("AlreadySubscribed", {
  crn: Crn,
  message: Schema.String
}) {}

/** The server does not know a class with this CRN. */
export class ClassNotFound extends Schema.TaggedError<ClassNotFound>()("ClassNotFound", {
  crn: Crn,
  message: Schema.String
}) {}

/** The user tried to unsubscribe from a class they are not subscribed to. */
export class NotSubscribed extends Schema.TaggedError<NotSubscribed>()("NotSubscribed", {
  crn: Crn,
  message: Schema.String
}) {}

/**
 * The server refused the request for another reason (HTTP 400), such as an
 * invalid email. `message` says why.
 */
export class RequestRejected extends Schema.TaggedError<RequestRejected>()("RequestRejected", {
  message: Schema.String
}) {}

/** The request never reached the server: offline, DNS failure, blocked, ... */
export class NetworkError extends Schema.TaggedError<NetworkError>()("NetworkError", {
  cause: Schema.Defect()
}) {}

/**
 * The server answered with something we do not understand: an unexpected
 * status code, a body that is not JSON, or JSON of the wrong shape.
 */
export class ServerError extends Schema.TaggedError<ServerError>()("ServerError", {
  status: Schema.Number,
  message: Schema.String
}) {}

/** An action needs saved credentials and there are none. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", {}) {}

/** Reading from or writing to the browser's extension storage failed. */
export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  cause: Schema.Defect()
}) {}

/**
 * A bug: something failed in a way no code path expected. The React bridge
 * (`lib/react.ts`) wraps such failures in this error so a component always has
 * something to show.
 */
export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()("UnexpectedError", {
  cause: Schema.Defect()
}) {}

/** Every error a user interface may have to show. */
export type AppError =
  | WrongPin
  | AlreadySubscribed
  | ClassNotFound
  | NotSubscribed
  | RequestRejected
  | NetworkError
  | ServerError
  | NotSignedIn
  | StorageError
  | UnexpectedError
