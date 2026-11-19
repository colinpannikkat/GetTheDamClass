/**
 * A `University` for tests that knows only the classes and terms a test gives
 * it, and keeps a list of what it was asked. (The real one, reading real
 * pages saved from the university, is tested in src/University.test.ts.)
 */
import { ClassNotFound, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Effect, Layer } from "effect"
import { type ListedTerm, type MeetingDates, type Seats, University } from "../src/University"

export interface FakeClass {
  readonly title: string
  readonly seats: Seats
  /** The dates it meets. Without them, a class without dates. */
  readonly dates?: MeetingDates
}

export interface FakeUniversity {
  /** The classes it knows, by "term/crn": "202702/33940". Tests may change them. */
  readonly classes: Map<string, FakeClass>
  /** Its term list. Tests may replace it. */
  terms: ReadonlyArray<ListedTerm>
  /** While true, every question fails as if the university were down. */
  down: boolean
  /**
   * Every question asked, as "classTitle 202702/33940", "seats 202702/33940",
   * "meetingDates 202702/33940" or "terms".
   */
  readonly calls: Array<string>
  /**
   * When set, runs the next time the university is asked about a class (not
   * for the term list), before it answers, and is then cleared. For making
   * something happen while a request or a job waits for the university.
   */
  meanwhile: Effect.Effect<void> | undefined
  readonly layer: Layer.Layer<University>
}

const noDates: MeetingDates = { starts: [], ends: [] }

export const makeFakeUniversity = (
  classes: Record<string, FakeClass>,
  terms: ReadonlyArray<ListedTerm>
): FakeUniversity => {
  const university: FakeUniversity = {
    classes: new Map(Object.entries(classes)),
    terms,
    down: false,
    calls: [],
    meanwhile: undefined,
    layer: Layer.succeed(University, {
      classTitle: (term, crn) => Effect.map(lookUp("classTitle", term, crn), (found) => found.title),
      seats: (term, crn) => Effect.map(lookUp("seats", term, crn), (found) => found.seats),
      // The real one has no answer for "no such class"; subscribe looks up
      // the title first, which has.
      meetingDates: (term, crn) =>
        Effect.map(
          askAboutClass(`meetingDates ${term}/${crn}`),
          () => university.classes.get(`${term}/${crn}`)?.dates ?? noDates
        ),
      terms: () => Effect.map(ask("terms"), () => university.terms)
    })
  }

  /** Note the question, and fail if the university is down. */
  const ask = (question: string) =>
    Effect.suspend(() => {
      university.calls.push(question)
      return university.down
        ? Effect.fail(new UniversityUnavailable({ message: "The university is down (in this test)." }))
        : Effect.void
    })

  /** The same, after running `meanwhile`. */
  const askAboutClass = (question: string) =>
    Effect.gen(function*() {
      const meanwhile = university.meanwhile
      if (meanwhile !== undefined) {
        university.meanwhile = undefined
        yield* meanwhile
      }
      yield* ask(question)
    })

  const lookUp = (question: string, term: string, crn: string) =>
    Effect.gen(function*() {
      yield* askAboutClass(`${question} ${term}/${crn}`)
      const found = university.classes.get(`${term}/${crn}`)
      if (found === undefined) {
        return yield* new ClassNotFound({ message: `No class ${term}/${crn} (in this test).` })
      }
      return found
    })

  return university
}
