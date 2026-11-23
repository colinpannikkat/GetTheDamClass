import { Api } from "@getthedamclass/shared/Api"
import { Clock, Console, Effect, Layer, Scheduler } from "effect"
import { SecureRandom } from "effect/crypto"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { ServerLayer } from "../src/server"
import { SignInEmailsPerDay } from "../src/signIn"
import type { ListedTerm } from "../src/University"
import { PublicUrl } from "../src/unsubscribe"
import { type FakeClass, makeFakeUniversity } from "./FakeUniversity"
import { makeRecordingMailer } from "./RecordingMailer"
import { TestDatabase } from "./TestDatabase"

export const PUBLIC_URL = "https://api.test"

export const INTRO_TO_CS = { term: "202702", crn: "33940" } as const
const defaultClasses: Record<string, FakeClass> = {
  "202702/33940": {
    title: "INTRO TO COMPUTER SCIENCE I",
    seats: { enrolled: 60, capacity: 60 },
    dates: { starts: ["2027-01-04"], ends: ["2027-03-12"] }
  }
}

export const TERMS: ReadonlyArray<ListedTerm> = [
  { code: "202703", name: "Spring 2027", open: false },
  { code: "202702", name: "Winter 2027", open: true },
  { code: "202701", name: "Fall 2026", open: true },
  { code: "202700", name: "Summer 2026", open: false }
]

const countingRandom = () => {
  let draws = 0
  return SecureRandom.make((size) => new Uint8Array(size).fill(++draws % 256))
}

const DEFAULT_SIGN_IN_EMAILS_PER_DAY = 1_000

export const makeTestServer = Effect.fn("makeTestServer")(function*(options: {
  readonly classes?: Record<string, FakeClass>
  readonly signInEmailsPerDay?: number
} = {}) {
  const { classes = defaultClasses, signInEmailsPerDay = DEFAULT_SIGN_IN_EMAILS_PER_DAY } = options
  const mailer = makeRecordingMailer()
  const university = makeFakeUniversity(classes, TERMS)
  const services = yield* Layer.build(Layer.mergeAll(
    TestDatabase,
    mailer.layer,
    university.layer,
    Layer.succeed(PublicUrl, PUBLIC_URL),
    Layer.succeed(SignInEmailsPerDay, signInEmailsPerDay),
    Layer.succeed(SecureRandom.SecureRandom, countingRandom()),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(Console.Console, yield* Console.Console),
    // Yield after every step so concurrent requests interleave between statements, as they do on D1;
    // otherwise no test could catch a check split from its write.
    Layer.succeed(Scheduler.MaxOpsBeforeYield, 1)
  ))

  const { handler, dispose } = HttpRouter.toWebHandler(
    ServerLayer.pipe(Layer.provideMerge(Layer.succeedContext(services))),
    { disableLogger: true }
  )
  yield* Effect.addFinalizer(() => Effect.promise(dispose))

  const fetch: typeof globalThis.fetch = (input, init) => handler(new Request(input, init))

  const client = (token?: string) =>
    HttpApiClient.make(Api, {
      baseUrl: PUBLIC_URL,
      transformClient: token === undefined ? undefined : HttpClient.mapRequest(HttpClientRequest.bearerToken(token))
    }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, fetch))

  const lastCode = (email: string) => {
    const message = mailer.sent.findLast((sent) => sent.to === email && sent.subject.includes("code"))
    const code = message?.subject.match(/\d{6}/)?.[0]
    if (code === undefined) {
      throw new Error(`No sign-in code was emailed to ${email}`)
    }
    return code
  }

  const signIn = Effect.fn("TestServer.signIn")(function*(email: string) {
    const api = yield* client()
    yield* api.signIn.sendCode({ payload: { email } })
    const { token } = yield* api.signIn.signIn({ payload: { email, code: lastCode(email) } })
    return token
  })

  const sql = SqlClient.SqlClient.pipe(Effect.provide(services))

  const run = <A, E, R>(job: Effect.Effect<A, E, R>) => Effect.provide(job, services)

  return { fetch, client, signIn, lastCode, mailer, university, sql, run }
})

export type TestServer = Effect.Success<ReturnType<typeof makeTestServer>>
