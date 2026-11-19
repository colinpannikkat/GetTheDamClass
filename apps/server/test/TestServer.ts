/**
 * The whole server (src/server.ts) running in the test, with a typed client
 * for it built from the API in packages/shared, the way the extension will
 * call it. Nothing leaves the process: requests go straight to the server's
 * `fetch` handler, as Cloudflare would deliver them.
 *
 * Around the real server: a real SQLite database (TestDatabase.ts), a mailer
 * that keeps the messages (RecordingMailer.ts), and a university that knows
 * the classes the test gives it (FakeUniversity.ts). The jobs Cloudflare runs
 * on a schedule run on the same services, with `run`.
 *
 * Use it inside `it.effect`. The server then runs on the test's clock, so
 * `TestClock.adjust("15 minutes")` moves time for the server too, and logs to
 * the test's console, so `TestConsole.logLines` holds what the server logged.
 */
import { Api } from "@getthedamclass/shared/Api"
import { Clock, Console, Effect, Layer } from "effect"
import { SecureRandom } from "effect/crypto"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { ServerLayer } from "../src/server"
import type { ListedTerm } from "../src/University"
import { PublicUrl } from "../src/unsubscribe"
import { type FakeClass, makeFakeUniversity } from "./FakeUniversity"
import { makeRecordingMailer } from "./RecordingMailer"
import { TestDatabase } from "./TestDatabase"

export const PUBLIC_URL = "https://api.test"

/**
 * A class the fake university knows unless a test says otherwise. It runs
 * from Monday 2027-01-04 to 2027-03-12, so its add deadline is 2027-01-17.
 */
export const INTRO_TO_CS = { term: "202702", crn: "33940" } as const
const defaultClasses: Record<string, FakeClass> = {
  "202702/33940": {
    title: "INTRO TO COMPUTER SCIENCE I",
    seats: { enrolled: 60, capacity: 60 },
    meetings: [{ start: "2027-01-04", end: "2027-03-12" }]
  }
}

/** The fake university's term list unless a test says otherwise: the real one of November 2026, shortened. */
export const TERMS: ReadonlyArray<ListedTerm> = [
  { code: "202703", name: "Spring 2027", open: false },
  { code: "202702", name: "Winter 2027", open: true },
  { code: "202701", name: "Fall 2026", open: true },
  { code: "202700", name: "Summer 2026", open: false }
]

/**
 * Randomness the test controls: every draw (a code, a token, a key) is bytes
 * all of one value, counting up from 1. So every run gets the same ones, and
 * no two draws are alike for the first 255, far more than a test makes.
 */
const countingRandom = () => {
  let draws = 0
  return SecureRandom.make((size) => new Uint8Array(size).fill(++draws % 256))
}

export const makeTestServer = Effect.fn("makeTestServer")(function*(classes: Record<string, FakeClass> = defaultClasses) {
  const mailer = makeRecordingMailer()
  const university = makeFakeUniversity(classes, TERMS)
  // Built here rather than inside the server, so that the test can query the
  // same database (`sql` below) and run jobs on the same services (`run`).
  const services = yield* Layer.build(Layer.mergeAll(
    TestDatabase,
    mailer.layer,
    university.layer,
    Layer.succeed(PublicUrl, PUBLIC_URL),
    Layer.succeed(SecureRandom.SecureRandom, countingRandom()),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(Console.Console, yield* Console.Console)
  ))

  const { handler, dispose } = HttpRouter.toWebHandler(
    ServerLayer.pipe(Layer.provideMerge(Layer.succeedContext(services))),
    { disableLogger: true }
  )
  yield* Effect.addFinalizer(() => Effect.promise(dispose))

  /** Send one request to the server, as `fetch` would. */
  const fetch: typeof globalThis.fetch = (input, init) => handler(new Request(input, init))

  /** A client for the API. With a token, every request carries it, like a signed-in browser. */
  const client = (token?: string) =>
    HttpApiClient.make(Api, {
      baseUrl: PUBLIC_URL,
      transformClient: token === undefined ? undefined : HttpClient.mapRequest(HttpClientRequest.bearerToken(token))
    }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, fetch))

  /** The code in the last email sent to this address. */
  const lastCode = (email: string) => {
    const message = mailer.sent.findLast((sent) => sent.to === email && sent.subject.includes("code"))
    const code = message?.subject.match(/\d{6}/)?.[0]
    if (code === undefined) {
      throw new Error(`No sign-in code was emailed to ${email}`)
    }
    return code
  }

  /** Sign in the whole way (ask for a code, read it, trade it), and return the token. */
  const signIn = Effect.fn("TestServer.signIn")(function*(email: string) {
    const api = yield* client()
    yield* api.signIn.sendCode({ payload: { email } })
    const { token } = yield* api.signIn.signIn({ payload: { email, code: lastCode(email) } })
    return token
  })

  /** The server's database, for looking at what it stored. */
  const sql = SqlClient.SqlClient.pipe(Effect.provide(services))

  /** Run a job (the check every minute, the daily job) on the server's services, as Cloudflare would. */
  const run = <A, E, R>(job: Effect.Effect<A, E, R>) => Effect.provide(job, services)

  return { fetch, client, signIn, lastCode, mailer, university, sql, run }
})
