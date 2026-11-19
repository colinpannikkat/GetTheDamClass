/**
 * The server, as an Effect service.
 *
 * The server's API is defined once, in packages/shared (`src/Api.ts` there):
 * every endpoint, what it takes and what it answers. Effect's `HttpApiClient`
 * turns that definition into typed functions that build each request and
 * check each reply, so this file holds no paths, status codes or JSON. It only
 * adds what the extension needs around those functions:
 *
 * - where the server is (`API_BASE_URL`);
 * - the sign-in token, sent as `Authorization: Bearer <token>`;
 * - a time limit on every call;
 * - the extension's own two errors for a call that went wrong without the
 *   server refusing it: `NetworkError` (no answer) and `ServerError` (an answer
 *   the API does not describe).
 *
 * The server's refusals (`NotSignedIn`, `TermNotOpen`, ...) come through as
 * the API's own errors, each with a sentence written for the student.
 */
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

/**
 * Where the server is. A normal build (`pnpm build`, which runs in Vite's
 * "production" mode) talks to the real one. Every other mode talks to the
 * server that `pnpm dev` runs on this computer in apps/server: `pnpm dev` here
 * ("development" mode), `pnpm build:local` ("local-server" mode), and the tests.
 */
export const API_BASE_URL = import.meta.env.MODE === "production"
  ? "https://api.getthedamclass.ajinkya.dev"
  : "http://localhost:5173"

/** How long a call may take before it fails with a `NetworkError`. */
const REQUEST_TIMEOUT = "30 seconds"

/** Errors any call can fail with, besides the server's refusals. */
type CallError = NetworkError | ServerError

/**
 * The service: its name, and the functions it offers. Each function returns an
 * `Effect<Success, Error>`, a description of the call that runs only when
 * something executes it (see `lib/runtime.ts`).
 *
 * `token` is the sign-in token the server gave this browser (`signIn`). The
 * server answers `NotSignedIn` when it no longer knows it.
 */
export class Api extends Context.Service<Api, {
  /** Email a fresh six-digit sign-in code to this address. */
  sendCode(email: EmailAddress): Effect.Effect<void, CodeRecentlySent | EmailNotSent | CallError>
  /** Trade the emailed code for a sign-in token, creating the account if the address is new. */
  signIn(email: EmailAddress, code: SignInCode): Effect.Effect<string, InvalidCode | CallError>
  /** End this token on the server. */
  signOut(token: string): Effect.Effect<void, NotSignedIn | CallError>
  /** Delete the account, its alerts, and the tokens of every browser it is signed in on. */
  deleteAccount(token: string): Effect.Effect<void, NotSignedIn | CallError>
  /** Every class the account gets alerts for. */
  listAlerts(token: string): Effect.Effect<ReadonlyArray<Alert>, NotSignedIn | CallError>
  /** Start vacancy alerts for a class. */
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
  /** Stop vacancy alerts for a class. */
  unsubscribe(token: string, classId: ClassId): Effect.Effect<void, NotSignedIn | NotSubscribed | CallError>
}>()("getthedamclass/Api") {
  /** The same implementation on top of a `fetch` you supply. For tests. */
  static readonly layerWithFetch = (fetch: typeof globalThis.fetch) =>
    Layer.effect(Api, makeApi()).pipe(Layer.provide(httpClientLayer(fetch)))

  /**
   * The real implementation, used by the extension. It looks `fetch` up at
   * call time (rather than capturing it once) so a test or a polyfill can
   * replace the global.
   */
  static readonly layer = Api.layerWithFetch((input, init) => globalThis.fetch(input, init))
}

// A UI test that needs a fake server does not need `fetch` at all:
//
//   Layer.mock(Api, { listAlerts: () => Effect.succeed([]) })
//
// builds an Api where only the functions you list work.

/**
 * Effect's HTTP client on top of `fetch`, with one setting changed: no
 * tracing headers. By default every request carries `traceparent` and `b3`
 * headers, and a browser only sends headers that the server's CORS answer
 * allows (`Cors` in apps/server/src/server.ts allows `authorization` and
 * `content-type`). With them, every call would fail before it left the
 * browser.
 */
function httpClientLayer(fetch: typeof globalThis.fetch) {
  return FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  )
}

/**
 * A step added to every call. The typed client fails with an
 * `HttpClientError` when no request could be sent or the reply has a status
 * the API does not list, and with a `SchemaError` when a reply does not match
 * the API's schemas. Those become the extension's own errors. And a call gives
 * up after a while, so a server that never answers cannot leave a spinner on
 * screen forever. (Giving up aborts the request.)
 */
const settle = <A, E, R>(
  call: Effect.Effect<A, E | HttpClientError.HttpClientError | Schema.SchemaError, R>
): Effect.Effect<A, E | NetworkError | ServerError, R> =>
  call.pipe(
    Effect.mapError((error) => {
      if (HttpClientError.isHttpClientError(error)) {
        // A "transport" error means `fetch` itself failed: offline, the
        // server down, or the browser refused to send the request.
        return error.reason._tag === "TransportError" ? new NetworkError({ cause: error }) : new ServerError({ cause: error })
      }
      return error instanceof Schema.SchemaError ? new ServerError({ cause: error }) : error
    }),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () => Effect.fail(new NetworkError({ cause: `No answer within ${REQUEST_TIMEOUT}.` }))
    })
  )

// A function declaration (unlike `const`) can be used above, in `Api`'s
// static fields, which run while the class is being defined.
function makeApi() {
  return Effect.gen(function*() {
    const httpClient = yield* HttpClient.HttpClient

    /** The typed client, sending this token with every request (or none, to sign in). */
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
