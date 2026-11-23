import { ClassNotFound, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Effect, Layer } from "effect"
import { type ListedTerm, type MeetingDates, type Seats, University } from "../src/University"

export interface FakeClass {
  readonly title: string
  readonly seats: Seats
  readonly dates?: MeetingDates
}

export interface FakeUniversity {
  readonly classes: Map<string, FakeClass>
  terms: ReadonlyArray<ListedTerm>
  down: boolean
  readonly calls: Array<string>
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
      // The real one has no answer for "no such class"; subscribe looks up the title first, which has.
      meetingDates: (term, crn) =>
        Effect.map(
          askAboutClass(`meetingDates ${term}/${crn}`),
          () => university.classes.get(`${term}/${crn}`)?.dates ?? noDates
        ),
      terms: () => Effect.map(ask("terms"), () => university.terms)
    })
  }

  const ask = (question: string) =>
    Effect.suspend(() => {
      university.calls.push(question)
      return university.down
        ? Effect.fail(new UniversityUnavailable({ message: "The university is down (in this test)." }))
        : Effect.void
    })

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
