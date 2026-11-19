/**
 * The backend, as an Effect service.
 *
 * Every call is a `POST` with a JSON body. The backend has no sessions, so the
 * email and PIN travel with each request. Its source and documentation live at
 * https://github.com/aj-arts/GetTheDamClass-Backend
 */
import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  AlreadySubscribed,
  ClassNotFound,
  type Credentials,
  Crn,
  NetworkError,
  NotSubscribed,
  RequestRejected,
  ServerError,
  type Subscription,
  WrongPin
} from "./domain"

export const API_BASE_URL = "https://api.getthedamclass.sarvesh.me"

/** How long a call may take before it fails with a `NetworkError`. */
const REQUEST_TIMEOUT = "30 seconds"

/** Errors any call can fail with. */
type CommonError = WrongPin | RequestRejected | NetworkError | ServerError

/**
 * The service: its name, and the functions it offers. Each function returns an
 * `Effect<Success, Error>`, a description of the call that runs only when
 * something executes it (see `lib/runtime.ts`).
 */
export class Api extends Context.Service<Api, {
  /** Log in, or create the account if the email is new. */
  signIn(credentials: Credentials): Effect.Effect<void, CommonError>
  /** Start vacancy alerts for a class. */
  subscribe(crn: Crn, credentials: Credentials): Effect.Effect<void, CommonError | AlreadySubscribed | ClassNotFound>
  /** Stop vacancy alerts for a class. */
  unsubscribe(crn: Crn, credentials: Credentials): Effect.Effect<void, CommonError | NotSubscribed | ClassNotFound>
  /** Every class the user gets alerts for. */
  listSubscriptions(credentials: Credentials): Effect.Effect<ReadonlyArray<Subscription>, CommonError>
}>()("getthedamclass/Api") {
  /** The real implementation, used by the extension. */
  static readonly layer = Layer.succeed(
    Api,
    // Look `fetch` up at call time (rather than capturing it once) so a test
    // or a polyfill can replace the global.
    makeApi((input, init) => globalThis.fetch(input, init))
  )

  /** The same implementation on top of a `fetch` you supply. For tests. */
  static readonly layerWithFetch = (fetch: Fetch) => Layer.succeed(Api, makeApi(fetch))
}

// A UI test that needs a fake backend does not need `fetch` at all:
//
//   Layer.mock(Api, { listSubscriptions: () => Effect.succeed([]) })
//
// builds an Api where only the functions you list work.

type Fetch = typeof globalThis.fetch

// ---------------------------------------------------------------------------
// What the server sends back
// ---------------------------------------------------------------------------

/** Most responses, successes and errors alike, are `{"message": "..."}`. */
const MessageBody = Schema.Struct({ message: Schema.String })
const decodeMessageBody = Schema.decodeUnknownOption(MessageBody)

/**
 * The body of a successful `/getsubs` response. `crn` really is a JSON number
 * there (the database column is an integer), although the rest of the API
 * uses strings. `name` should always be the course title; it is read
 * leniently, so that one odd name cannot hide the whole list. Anything that
 * is not text is shown as "no name".
 */
const SubscriptionsBody = Schema.Struct({
  subs: Schema.Array(
    Schema.Struct({
      crn: Schema.Union([Schema.Int, Crn]),
      name: Schema.optional(Schema.Union([Schema.String, Schema.Boolean, Schema.Null]))
    })
  )
})
const decodeSubscriptionsBody = Schema.decodeUnknownEffect(SubscriptionsBody)

/** The server only tells these two `400` cases apart by their message. */
const CRN_NOT_FOUND_MESSAGE = "CRN doesn't exist"
const NOT_SUBSCRIBED_MESSAGE = "Not subscribed to class"

interface JsonResponse {
  readonly status: number
  readonly body: unknown
  /** The server's `message`, or a stand-in when the body has none. */
  readonly message: string
}

const unexpectedStatus = (response: JsonResponse) =>
  new ServerError({ status: response.status, message: response.message })

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function makeApi(fetch: Fetch): Api["Service"] {
  /**
   * Send one request and parse the reply as JSON. Succeeds for every HTTP
   * status; each endpoint below decides what its statuses mean.
   */
  const post = Effect.fn("Api.post")(function*(path: string, payload: object) {
    const response = yield* Effect.tryPromise({
      // Effect passes a `signal` that aborts the request if the caller stops
      // waiting: the popup closed, or the time below ran out.
      try: (signal) =>
        fetch(`${API_BASE_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal
        }),
      catch: (cause) => new NetworkError({ cause })
    })
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new NetworkError({ cause })
    })
    const body = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: () => new ServerError({ status: response.status, message: "The server's reply was not JSON." })
    })
    const message = Option.match(decodeMessageBody(body), {
      onNone: () => `The server replied with HTTP ${response.status}.`,
      onSome: (decoded) => decoded.message
    })
    return { status: response.status, body, message } satisfies JsonResponse
  },
  // A step added to every call: give up after a while, so a server that never
  // answers cannot leave a spinner on screen forever.
  Effect.timeoutOrElse({
    duration: REQUEST_TIMEOUT,
    orElse: () => Effect.fail(new NetworkError({ cause: `No answer within ${REQUEST_TIMEOUT}.` }))
  }))

  const signIn = Effect.fn("Api.signIn")(function*(credentials: Credentials) {
    const response = yield* post("/signup", { email: credentials.email, pin: credentials.pin })
    switch (response.status) {
      case 200:
        return
      case 401:
        // `return yield*` on an error stops the function with that error.
        return yield* new WrongPin({ message: response.message })
      case 400:
        return yield* new RequestRejected({ message: response.message })
      default:
        return yield* unexpectedStatus(response)
    }
  })

  const subscribe = Effect.fn("Api.subscribe")(function*(crn: Crn, credentials: Credentials) {
    const response = yield* post("/sub", { crn, email: credentials.email, pin: credentials.pin })
    switch (response.status) {
      case 200:
        return
      case 409:
        return yield* new AlreadySubscribed({ crn })
      case 401:
        return yield* new WrongPin({ message: response.message })
      case 400:
        return response.message === CRN_NOT_FOUND_MESSAGE
          ? yield* new ClassNotFound({ crn })
          : yield* new RequestRejected({ message: response.message })
      default:
        return yield* unexpectedStatus(response)
    }
  })

  const unsubscribe = Effect.fn("Api.unsubscribe")(function*(crn: Crn, credentials: Credentials) {
    const response = yield* post("/unsub", { crn, email: credentials.email, pin: credentials.pin })
    switch (response.status) {
      case 200:
        return
      case 401:
        return yield* new WrongPin({ message: response.message })
      case 400:
        if (response.message === CRN_NOT_FOUND_MESSAGE) {
          return yield* new ClassNotFound({ crn })
        }
        if (response.message === NOT_SUBSCRIBED_MESSAGE) {
          return yield* new NotSubscribed({ crn })
        }
        return yield* new RequestRejected({ message: response.message })
      default:
        return yield* unexpectedStatus(response)
    }
  })

  const listSubscriptions = Effect.fn("Api.listSubscriptions")(function*(credentials: Credentials) {
    const response = yield* post("/getsubs", { email: credentials.email, pin: credentials.pin })
    switch (response.status) {
      case 200: {
        const decoded = yield* decodeSubscriptionsBody(response.body).pipe(
          Effect.mapError(() =>
            new ServerError({ status: 200, message: "The list of subscriptions has an unexpected shape." })
          )
        )
        return decoded.subs.map((sub): Subscription => ({
          crn: String(sub.crn),
          name: typeof sub.name === "string" && sub.name.trim() !== "" ? sub.name.trim() : null
        }))
      }
      case 401:
        return yield* new WrongPin({ message: response.message })
      case 400:
        return yield* new RequestRejected({ message: response.message })
      default:
        return yield* unexpectedStatus(response)
    }
  })

  // A plain object rather than `Api.of(...)`: this function is called while
  // the `Api` class above is still being defined, so it cannot refer to it.
  return { signIn, subscribe, unsubscribe, listSubscriptions }
}
