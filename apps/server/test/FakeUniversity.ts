/**
 * A `University` for tests that knows only the classes a test gives it, and
 * keeps a list of what it was asked. (The real one, reading real pages saved
 * from the university, is tested in src/University.test.ts.)
 */
import { ClassNotFound, UniversityUnavailable } from "@getthedamclass/shared/domain"
import { Effect, Layer } from "effect"
import { type Seats, University } from "../src/University"

export interface FakeClass {
  readonly title: string
  readonly seats: Seats
}

export interface FakeUniversity {
  /** The classes it knows, by "term/crn": "202702/33940". Tests may change them. */
  readonly classes: Map<string, FakeClass>
  /** While true, every question fails as if the university were down. */
  down: boolean
  /** Every question asked, as "classTitle 202702/33940" or "seats 202702/33940". */
  readonly calls: Array<string>
  readonly layer: Layer.Layer<University>
}

export const makeFakeUniversity = (classes: Record<string, FakeClass>): FakeUniversity => {
  const university: FakeUniversity = {
    classes: new Map(Object.entries(classes)),
    down: false,
    calls: [],
    layer: Layer.succeed(University, {
      classTitle: (term, crn) => Effect.map(lookUp("classTitle", term, crn), (found) => found.title),
      seats: (term, crn) => Effect.map(lookUp("seats", term, crn), (found) => found.seats)
    })
  }

  const lookUp = (
    question: string,
    term: string,
    crn: string
  ) =>
    Effect.suspend((): Effect.Effect<FakeClass, ClassNotFound | UniversityUnavailable> => {
      university.calls.push(`${question} ${term}/${crn}`)
      if (university.down) {
        return Effect.fail(new UniversityUnavailable({ message: "The university is down (in this test)." }))
      }
      const found = university.classes.get(`${term}/${crn}`)
      return found === undefined
        ? Effect.fail(new ClassNotFound({ message: `No class ${term}/${crn} (in this test).` }))
        : Effect.succeed(found)
    })

  return university
}
