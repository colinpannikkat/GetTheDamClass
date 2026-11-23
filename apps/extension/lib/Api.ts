import { Api as ServerApi } from "@getthedamclass/shared/Api"
import type {
  AddDeadlinePassed,
  Alert,
  AlreadySubscribed,
  ClassNotFound,
  CodeRecentlySent,
  EmailAddress,
  EmailNotSent,
  InvalidCode,
  NotSignedIn,
  NotSubscribed,
  SignInCode,
  TermNotOpen,
  UniversityUnavailable
} from "@getthedamclass/shared/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { type ClassId, NetworkError, ServerError } from "./domain"

// Only a normal ("production") build talks to the real server; every other mode, and the tests,
// use the one `pnpm dev` runs in apps/server.
export const API_BASE_URL = import.meta.env.MODE === "production"
  ? "https://api.getthedamclass.ajinkya.dev"
  : "http://localhost:5173"

const REQUEST_TIMEOUT = "30 seconds"

type CallError = NetworkError | ServerError

export class Api extends Context.Service<Api, {
  sendCode(email: EmailAddress): Effect.Effect<void, CodeRecentlySent | EmailNotSent | CallError>
  signIn(email: EmailAddress, code: SignInCode): Effect.Effect<string, InvalidCode | CallError>
  signOut(token: string): Effect.Effect<void, NotSignedIn | CallError>
  deleteAccount(token: string): Effect.Effect<void, NotSignedIn | CallError>
  listAlerts(token: string): Effect.Effect<ReadonlyArray<Alert>, NotSignedIn | CallError>
  subscribe(
    token: string,
    classId: ClassId
  ): Effect.Effect<
    Alert,
    | NotSignedIn
    | AlreadySubscribed
    | ClassNotFound
    | TermNotOpen
    | AddDeadlinePassed
    | UniversityUnavailable
    | CallError
  >
  unsubscribe(token: string, classId: ClassId): Effect.Effect<void, NotSignedIn | NotSubscribed | CallError>
}>()("getthedamclass/Api") {
  static readonly layerWithFetch = (fetch: typeof globalThis.fetch) =>
    Layer.effect(Api, makeApi()).pipe(Layer.provide(httpClientLayer(fetch)))

  static readonly layer = Api.layerWithFetch((input, init) => globalThis.fetch(input, init))
}

// No tracing headers: the server's CORS answer allows only `authorization` and `content-type`, so
// `traceparent` and `b3` would make every call fail.
function httpClientLayer(fetch: typeof globalThis.fetch) {
  return FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  )
}

const settle = <A, E, R>(
  call: Effect.Effect<A, E | HttpClientError.HttpClientError | Schema.SchemaError, R>
): Effect.Effect<A, E | NetworkError | ServerError, R> =>
  call.pipe(
    Effect.mapError((error) => {
      if (HttpClientError.isHttpClientError(error)) {
        return error.reason._tag === "TransportError" ? new NetworkError({ cause: error }) : new ServerError({ cause: error })
      }
      return error instanceof Schema.SchemaError ? new ServerError({ cause: error }) : error
    }),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () => Effect.fail(new NetworkError({ cause: `No answer within ${REQUEST_TIMEOUT}.` }))
    })
  )

function makeApi() {
  return Effect.gen(function*() {
    const httpClient = yield* HttpClient.HttpClient

    const clientWith = (token?: string) =>
      HttpApiClient.makeWith(ServerApi, {
        baseUrl: API_BASE_URL,
        httpClient: token === undefined
          ? httpClient
          : httpClient.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(token)))
      })
    const signedOutClient = yield* clientWith()

    const sendCode = Effect.fn("Api.sendCode")(function*(email: EmailAddress) {
      yield* signedOutClient.signIn.sendCode({ payload: { email } })
    }, settle)

    const signIn = Effect.fn("Api.signIn")(function*(email: EmailAddress, code: SignInCode) {
      const { token } = yield* signedOutClient.signIn.signIn({ payload: { email, code } })
      return token
    }, settle)

    const signOut = Effect.fn("Api.signOut")(function*(token: string) {
      const client = yield* clientWith(token)
      yield* client.account.signOut()
    }, settle)

    const deleteAccount = Effect.fn("Api.deleteAccount")(function*(token: string) {
      const client = yield* clientWith(token)
      yield* client.account.deleteAccount()
    }, settle)

    const listAlerts = Effect.fn("Api.listAlerts")(function*(token: string) {
      const client = yield* clientWith(token)
      return yield* client.alerts.list()
    }, settle)

    const subscribe = Effect.fn("Api.subscribe")(function*(token: string, { term, crn }: ClassId) {
      const client = yield* clientWith(token)
      return yield* client.alerts.subscribe({ payload: { term, crn } })
    }, settle)

    const unsubscribe = Effect.fn("Api.unsubscribe")(function*(token: string, { term, crn }: ClassId) {
      const client = yield* clientWith(token)
      yield* client.alerts.unsubscribe({ params: { term, crn } })
    }, settle)

    return Api.of({ sendCode, signIn, signOut, deleteAccount, listAlerts, subscribe, unsubscribe })
  })
}
