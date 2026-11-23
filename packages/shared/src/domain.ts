import { Schema, SchemaTransformation } from "effect"

export const Term = Schema.String.check(Schema.isPattern(/^\d{6}$/))
export type Term = typeof Term.Type

export const Crn = Schema.String.check(Schema.isPattern(/^\d+$/))
export type Crn = typeof Crn.Type

export const EmailAddress = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isLowercased(), Schema.isPattern(/^[^\s@]+@[^\s@]+$/)),
    SchemaTransformation.toLowerCase()
  )
)
export type EmailAddress = typeof EmailAddress.Type

export const SignInCode = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String.check(Schema.isPattern(/^\d{6}$/)))
)
export type SignInCode = typeof SignInCode.Type

export const Alert = Schema.Struct({
  term: Term,
  crn: Crn,
  title: Schema.String
})
export type Alert = typeof Alert.Type

const refusal = { message: Schema.String }

export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", refusal, {
  httpApiStatus: 401
}) {}

export class CodeRecentlySent extends Schema.TaggedError<CodeRecentlySent>()("CodeRecentlySent", refusal, {
  httpApiStatus: 429
}) {}

// One error on purpose for every way a code fails: telling them apart would help someone guessing.
export class InvalidCode extends Schema.TaggedError<InvalidCode>()("InvalidCode", refusal, {
  httpApiStatus: 400
}) {}

export class EmailNotSent extends Schema.TaggedError<EmailNotSent>()("EmailNotSent", refusal, {
  httpApiStatus: 503
}) {}

export class ClassNotFound extends Schema.TaggedError<ClassNotFound>()("ClassNotFound", refusal, {
  httpApiStatus: 404
}) {}

export class UniversityUnavailable extends Schema.TaggedError<UniversityUnavailable>()(
  "UniversityUnavailable",
  refusal,
  { httpApiStatus: 502 }
) {}

export class TermNotOpen extends Schema.TaggedError<TermNotOpen>()("TermNotOpen", refusal, {
  httpApiStatus: 409
}) {}

export class AddDeadlinePassed extends Schema.TaggedError<AddDeadlinePassed>()("AddDeadlinePassed", refusal, {
  httpApiStatus: 409
}) {}

export class AlreadySubscribed extends Schema.TaggedError<AlreadySubscribed>()("AlreadySubscribed", refusal, {
  httpApiStatus: 409
}) {}

export class NotSubscribed extends Schema.TaggedError<NotSubscribed>()("NotSubscribed", refusal, {
  httpApiStatus: 404
}) {}
