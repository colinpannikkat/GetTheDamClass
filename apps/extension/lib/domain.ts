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

export interface ClassId {
  readonly term: Term
  readonly crn: Crn
}

export const sameClass = (a: ClassId, b: ClassId): boolean => a.term === b.term && a.crn === b.crn

export const alertLabel = (alert: Alert): string =>
  Option.match(termName(alert.term), {
    onNone: () => `${alert.title} (CRN ${alert.crn})`,
    onSome: (term) => `${alert.title} (CRN ${alert.crn}, ${term})`
  })

export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly cause: unknown }> {}

export class ServerError extends Data.TaggedError("ServerError")<{ readonly cause: unknown }> {}

export class StorageError extends Data.TaggedError("StorageError")<{ readonly cause: unknown }> {}

export class UnexpectedError extends Data.TaggedError("UnexpectedError")<{ readonly cause: unknown }> {}

// `AlreadySubscribed` and `NotSubscribed` are missing on purpose: the workflows treat them as done.
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
