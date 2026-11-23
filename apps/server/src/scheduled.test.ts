import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import config from "../cloudflare.config"
import { INTRO_TO_CS, makeTestServer } from "../test/TestServer"
import { DAILY, EVERY_MINUTE, runScheduled } from "./scheduled"

const watched = Effect.gen(function*() {
  const server = yield* makeTestServer()
  const api = yield* server.client(yield* server.signIn("student@example.com"))
  yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
  server.university.calls.length = 0
  return server
})

describe("the cron triggers", () => {
  it("in cloudflare.config.ts are the two this file tells apart", () => {
    for (const mode of ["development", "production"]) {
      const { worker } = config({ mode, isPreview: false })
      assert.deepStrictEqual(worker.triggers?.map((trigger) => trigger.schedule), [EVERY_MINUTE, DAILY])
    }
  })
})

describe("runScheduled", () => {
  it.effect("every minute: the check for open seats", () =>
    Effect.gen(function*() {
      const server = yield* watched
      yield* server.run(runScheduled(EVERY_MINUTE))
      assert.deepStrictEqual(server.university.calls, ["seats 202702/33940"])
    }))

  it.effect("daily: the cleanup", () =>
    Effect.gen(function*() {
      const server = yield* watched
      yield* server.run(runScheduled(DAILY))
      assert.deepStrictEqual(server.university.calls, ["terms"])
    }))

  it.effect("any other schedule: fails, and runs no job", () =>
    Effect.gen(function*() {
      const server = yield* watched
      const exit = yield* Effect.exit(server.run(runScheduled("*/5 * * * *")))
      assert.isTrue(Exit.isFailure(exit))
      assert.deepStrictEqual(server.university.calls, [])
    }))
})
