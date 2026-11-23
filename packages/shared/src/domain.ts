/**
 * The vocabulary of the API: the values that travel between the extension and
 * the server, and every error the server can answer with.
 *
 * Both sides check data against these schemas, so a rule written here (what a
 * CRN looks like, say) is enforced on the server and known to the client.
 */
import { Schema, SchemaTransformation } from "effect"

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// A convention you will see below: a schema and its type share one name.
// `Crn` the value checks data at runtime; `Crn` the type is what TypeScript
// sees. Which one is meant is always clear from where it is used.

/**
 * A term, as the university's six-digit code: the year the academic year ends,
 * then the term, so "202702" is Winter 2027.
 */
export const Term = Schema.String.check(Schema.isPattern(/^\d{6}$/))
export type Term = typeof Term.Type

/**
 * A Course Reference Number: the digits the university uses for one class
 * section within a term, for example "33940". The same CRN can mean another
 * class in another term, which is why an alert always names both.
 */
export const Crn = Schema.String.check(Schema.isPattern(/^\d+$/))
export type Crn = typeof Crn.Type

/**
 * An email address, which is also what identifies an account. Decoding trims
 * it and makes it lower case, so " Student@OregonState.edu" and
 * "student@oregonstate.edu" are one account. Any address works, not only
 * university ones; the only check is the shape "something@something".
 */
export const EmailAddress = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isLowercased(), Schema.isPattern(/^[^\s@]+@[^\s@]+$/)),
    SchemaTransformation.toLowerCase()
  )
)
export type EmailAddress = typeof EmailAddress.Type

/** The six digits emailed to a student to sign in. Spaces around them are ignored. */
export const SignInCode = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String.check(Schema.isPattern(/^\d{6}$/)))
)
export type SignInCode = typeof SignInCode.Type

/** One class a student gets vacancy alerts for. */
export const Alert = Schema.Struct({
  term: Term,
  crn: Crn,
  /** The course title, as the university names it: "INTRO TO COMPUTER SCIENCE I". */
  title: Schema.String
})
export type Alert = typeof Alert.Type

// ---------------------------------------------------------------------------
// Errors
//
// Each error has a `_tag` (its name as a string) that the client switches on,
// and an HTTP status. Its `message` is a sentence written for the student,
// which the extension shows as it is, so the client never has to read meaning
// out of text.
// ---------------------------------------------------------------------------

const refusal = { message: Schema.String }

/**
 * The request has no sign-in token, or one the server does not know: it was
 * never issued, that browser signed out, the account was deleted, or the
 * token went unused for a year.
 */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", refusal, {
  httpApiStatus: 401
}) {}

/** A code was sent to this address less than a minute ago. */
export class CodeRecentlySent extends Schema.TaggedError<CodeRecentlySent>()("CodeRecentlySent", refusal, {
  httpApiStatus: 429
}) {}

/**
 * The code is not one that signs in this address right now. On purpose, this
 * one error covers a wrong code, an expired one, one already used, one
 * cancelled after too many wrong tries, and an address that never asked for a
 * code: telling them apart would help someone guessing.
 */
export class InvalidCode extends Schema.TaggedError<InvalidCode>()("InvalidCode", refusal, {
  httpApiStatus: 400
}) {}

/**
 * The server did not send the email with the code: either sending failed
 * (asking again is fine), or the server has sent as many sign-in emails as it
 * allows in one day (asking again works the next day). The message says which.
 */
export class EmailNotSent extends Schema.TaggedError<EmailNotSent>()("EmailNotSent", refusal, {
  httpApiStatus: 503
}) {}

/** The university does not know a class with this CRN in this term. */
export class ClassNotFound extends Schema.TaggedError<ClassNotFound>()("ClassNotFound", refusal, {
  httpApiStatus: 404
}) {}

/**
 * The university's class system did not answer, or answered with something
 * other than a class or a clear "no such class". Trying later may work.
 */
export class UniversityUnavailable extends Schema.TaggedError<UniversityUnavailable>()(
  "UniversityUnavailable",
  refusal,
  { httpApiStatus: 502 }
) {}

/**
 * The class's term takes no new alerts: the university's class search does
 * not offer the term, or offers it as "View Only" because its registration
 * has not opened yet or is over. The sentence says which.
 */
export class TermNotOpen extends Schema.TaggedError<TermNotOpen>()("TermNotOpen", refusal, {
  httpApiStatus: 409
}) {}

/**
 * The class's add deadline has passed, so a seat opening would be of no use.
 * The sentence names the date. (How the deadline is worked out is in
 * apps/server/src/termRule.ts.)
 */
export class AddDeadlinePassed extends Schema.TaggedError<AddDeadlinePassed>()("AddDeadlinePassed", refusal, {
  httpApiStatus: 409
}) {}

/** The student already gets alerts for this class. */
export class AlreadySubscribed extends Schema.TaggedError<AlreadySubscribed>()("AlreadySubscribed", refusal, {
  httpApiStatus: 409
}) {}

/** The student does not get alerts for this class (perhaps stopped elsewhere already). */
export class NotSubscribed extends Schema.TaggedError<NotSubscribed>()("NotSubscribed", refusal, {
  httpApiStatus: 404
}) {}
