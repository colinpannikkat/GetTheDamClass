import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Api, API_BASE_URL } from "./Api"
import type { AlreadySubscribed, AppError, NotSubscribed } from "./domain"

// These tests never touch the network: `Api.layerWithFetch` builds the real
// Api on top of a fake `fetch` that answers with whatever the test says.

const credentials = { email: "student@oregonstate.edu", pin: "1234" }
const crn = "39835"

interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
}

/** A `Response` like the backend's: a status and a JSON body. */
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/** Build a fake `fetch`, and keep a list of the requests it received. */
function fakeFetch(respond: () => Response) {
  const requests: Array<RecordedRequest> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return respond()
  }
  return { fetch, requests }
}

/** Run one Api call against a server that always gives the same answer. */
const callApi = <A, E>(
  respond: () => Response,
  call: (api: Api["Service"]) => Effect.Effect<A, E>
) => Api.use(call).pipe(Effect.provide(Api.layerWithFetch(fakeFetch(respond).fetch)))

/** The same, for a call that is expected to fail: succeeds with the error. */
const callApiError = <A, E>(
  respond: () => Response,
  call: (api: Api["Service"]) => Effect.Effect<A, E>
) => Effect.flip(callApi(respond, call))

describe("requests", () => {
  /** Run a call and return the single request it made. */
  const requestOf = <A, E>(call: (api: Api["Service"]) => Effect.Effect<A, E>, body: unknown = { message: "ok" }) =>
    Effect.gen(function*() {
      const fake = fakeFetch(() => jsonResponse(200, body))
      yield* Api.use(call).pipe(Effect.provide(Api.layerWithFetch(fake.fetch)))
      assert.strictEqual(fake.requests.length, 1)
      return fake.requests[0]!
    })

  it.effect("signIn posts the email and PIN to /signup", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.signIn(credentials))
      assert.strictEqual(request.url, `${API_BASE_URL}/signup`)
      assert.strictEqual(request.init.method, "POST")
      assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
        email: "student@oregonstate.edu",
        pin: "1234"
      })
    }))

  it.effect("sends JSON, and none of the Access-Control headers version 1 sent", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.signIn(credentials))
      assert.deepStrictEqual(request.init.headers, { "Content-Type": "application/json" })
    }))

  it.effect("subscribe posts the CRN as a string, with the credentials, to /sub", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.subscribe(crn, credentials))
      assert.strictEqual(request.url, `${API_BASE_URL}/sub`)
      assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
        crn: "39835",
        email: "student@oregonstate.edu",
        pin: "1234"
      })
    }))

  it.effect("unsubscribe posts the CRN and the credentials to /unsub", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.unsubscribe(crn, credentials))
      assert.strictEqual(request.url, `${API_BASE_URL}/unsub`)
      assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
        crn: "39835",
        email: "student@oregonstate.edu",
        pin: "1234"
      })
    }))

  it.effect("listSubscriptions posts the credentials to /getsubs", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.listSubscriptions(credentials), { subs: [] })
      assert.strictEqual(request.url, `${API_BASE_URL}/getsubs`)
      assert.deepStrictEqual(JSON.parse(String(request.init.body)), {
        email: "student@oregonstate.edu",
        pin: "1234"
      })
    }))
})

describe("signIn", () => {
  it.effect.each([
    { title: "a new email, so the account was created", message: "User signed up successfully" },
    { title: "a known email", message: "User logged in" }
  ])("200 ($title): succeeds", ({ message }) =>
    callApi(() => jsonResponse(200, { message }), (api) => api.signIn(credentials)))

  it.effect("401: WrongPin, with the server's message", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(401, { message: "Wrong pin. Try again!" }),
        (api) => api.signIn(credentials)
      )
      assert.strictEqual(error._tag, "WrongPin")
      assert.strictEqual(error.message, "Wrong pin. Try again!")
    }))

  it.effect("400: RequestRejected, with the server's message", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "Invalid email or pin" }),
        (api) => api.signIn(credentials)
      )
      assert.strictEqual(error._tag, "RequestRejected")
      assert.strictEqual(error.message, "Invalid email or pin")
    }))
})

describe("subscribe", () => {
  it.effect("200: succeeds", () =>
    callApi(
      () => jsonResponse(200, { message: "student@oregonstate.edu subscribed to class 39835 successfully" }),
      (api) => api.subscribe(crn, credentials)
    ))

  it.effect("409: AlreadySubscribed", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(409, { message: "Already subscribed to class" }),
        (api) => api.subscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "AlreadySubscribed")
    }))

  it.effect("401: WrongPin", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(401, { message: "User authentication failed" }),
        (api) => api.subscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "WrongPin")
    }))

  it.effect("400 \"CRN doesn't exist\": ClassNotFound, carrying the CRN", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "CRN doesn't exist" }),
        (api) => api.subscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "ClassNotFound")
      assert.strictEqual(error._tag === "ClassNotFound" && error.crn, "39835")
    }))

  it.effect("any other 400: RequestRejected, with the server's message", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "Couldn't subscribe to class. Try again!" }),
        (api) => api.subscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "RequestRejected")
      assert.strictEqual(error.message, "Couldn't subscribe to class. Try again!")
    }))
})

describe("unsubscribe", () => {
  it.effect("200: succeeds", () =>
    callApi(
      () => jsonResponse(200, { message: "Unsubscribed from class 39835 successfully" }),
      (api) => api.unsubscribe(crn, credentials)
    ))

  it.effect("401: WrongPin", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(401, { message: "User authentication failed" }),
        (api) => api.unsubscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "WrongPin")
    }))

  it.effect("400 \"Not subscribed to class\": NotSubscribed", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "Not subscribed to class" }),
        (api) => api.unsubscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "NotSubscribed")
    }))

  it.effect("400 \"CRN doesn't exist\": ClassNotFound", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "CRN doesn't exist" }),
        (api) => api.unsubscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "ClassNotFound")
    }))

  it.effect("any other 400: RequestRejected", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "User doesn't exist" }),
        (api) => api.unsubscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "RequestRejected")
      assert.strictEqual(error.message, "User doesn't exist")
    }))
})

describe("listSubscriptions", () => {
  it.effect("200: returns the subscriptions", () =>
    Effect.gen(function*() {
      const subscriptions = yield* callApi(
        () => jsonResponse(200, { subs: [{ crn: "39835", name: "INTRO TO DEEP LEARNING" }] }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.deepStrictEqual(subscriptions, [{ crn: "39835", name: "INTRO TO DEEP LEARNING" }])
    }))

  it.effect("200 with no subscriptions: returns an empty list", () =>
    Effect.gen(function*() {
      const subscriptions = yield* callApi(
        () => jsonResponse(200, { subs: [] }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.deepStrictEqual(subscriptions, [])
    }))

  it.effect("quirk: the server sends the CRN as a number; we turn it into a string", () =>
    Effect.gen(function*() {
      const subscriptions = yield* callApi(
        () => jsonResponse(200, { subs: [{ crn: 39835, name: "INTRO TO DEEP LEARNING" }] }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.deepStrictEqual(subscriptions, [{ crn: "39835", name: "INTRO TO DEEP LEARNING" }])
    }))

  it.effect("a name that is blank, missing or not text at all becomes null, and the rest of the list still shows", () =>
    Effect.gen(function*() {
      const subscriptions = yield* callApi(
        () =>
          jsonResponse(200, {
            subs: [
              { crn: 1, name: false },
              { crn: 2, name: null },
              { crn: 3, name: "  " },
              { crn: 4 },
              { crn: 5, name: 161 },
              { crn: 6, name: { title: "INTRO TO DEEP LEARNING" } },
              { crn: 7, name: " INTRO TO DEEP LEARNING " }
            ]
          }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.deepStrictEqual(subscriptions, [
        { crn: "1", name: null },
        { crn: "2", name: null },
        { crn: "3", name: null },
        { crn: "4", name: null },
        { crn: "5", name: null },
        { crn: "6", name: null },
        { crn: "7", name: "INTRO TO DEEP LEARNING" }
      ])
    }))

  it.effect("401: WrongPin", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(401, { message: "User authentication failed" }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.strictEqual(error._tag, "WrongPin")
    }))

  it.effect("400: RequestRejected", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(400, { message: "Invalid email or pin" }),
        (api) => api.listSubscriptions(credentials)
      )
      assert.strictEqual(error._tag, "RequestRejected")
    }))

  it.effect.each([
    { title: "no subs field", body: { message: "ok" } },
    { title: "subs is not a list", body: { subs: "none" } },
    { title: "a CRN that is not digits", body: { subs: [{ crn: "abc", name: "X" }] } },
    { title: "a CRN that is not a whole number", body: { subs: [{ crn: 1.5, name: "X" }] } }
  ])("200 with a body of the wrong shape ($title): ServerError", ({ body }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => jsonResponse(200, body),
        (api) => api.listSubscriptions(credentials)
      )
      assert.strictEqual(error._tag, "ServerError")
    }))
})

describe("problems every call can have", () => {
  const everyCall: ReadonlyArray<{
    readonly name: string
    readonly call: (api: Api["Service"]) => Effect.Effect<unknown, AppError | AlreadySubscribed | NotSubscribed>
  }> = [
    { name: "signIn", call: (api) => api.signIn(credentials) },
    { name: "subscribe", call: (api) => api.subscribe(crn, credentials) },
    { name: "unsubscribe", call: (api) => api.unsubscribe(crn, credentials) },
    { name: "listSubscriptions", call: (api) => api.listSubscriptions(credentials) }
  ]

  it.effect("the request cannot be sent (offline): NetworkError", () =>
    Effect.gen(function*() {
      const cause = new TypeError("Failed to fetch")
      const error = yield* callApiError(
        () => {
          throw cause
        },
        (api) => api.signIn(credentials)
      )
      assert.strictEqual(error._tag, "NetworkError")
      assert.strictEqual(error._tag === "NetworkError" && error.cause, cause)
    }))

  it.effect.each(everyCall
  )("$name: no answer within 30 seconds: NetworkError, and the request is given up", ({ call }) =>
    Effect.gen(function*() {
      let signal: AbortSignal | null | undefined
      const neverAnswers: typeof globalThis.fetch = (_input, init) => {
        signal = init?.signal
        return new Promise(() => {})
      }
      // Run the call in the background, then move the test's clock forward.
      const running = yield* Effect.forkChild(
        Effect.flip(Api.use(call).pipe(Effect.provide(Api.layerWithFetch(neverAnswers))))
      )
      yield* TestClock.adjust("29 seconds")
      assert.isFalse(signal?.aborted)
      yield* TestClock.adjust("1 second")

      const error = yield* Fiber.join(running)
      assert.strictEqual(error._tag, "NetworkError")
      assert.isTrue(signal?.aborted)
    }))

  it.effect("the body is not JSON (a proxy's HTML error page): ServerError with the status", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
        (api) => api.subscribe(crn, credentials)
      )
      assert.strictEqual(error._tag, "ServerError")
      assert.strictEqual(error._tag === "ServerError" && error.status, 502)
    }))

  it.effect("a 200 whose body is not JSON: ServerError", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => new Response("OK", { status: 200 }),
        (api) => api.signIn(credentials)
      )
      assert.strictEqual(error._tag, "ServerError")
    }))

  it.effect.each(everyCall
  )("$name: a status the API does not document (500): ServerError", ({ call }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => jsonResponse(500, { message: "Internal Server Error" }), call)
      assert.strictEqual(error._tag, "ServerError")
      assert.strictEqual(error._tag === "ServerError" && error.status, 500)
      assert.strictEqual(error.message, "Internal Server Error")
    }))

  it.effect("an error without a message still gets a readable one", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => jsonResponse(401, {}), (api) => api.signIn(credentials))
      assert.strictEqual(error._tag, "WrongPin")
      assert.strictEqual(error.message, "The server replied with HTTP 401.")
    }))
})
