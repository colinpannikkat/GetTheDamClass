import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Api, API_BASE_URL } from "./Api"
import type { AppError } from "./domain"

// These tests never touch the network: `Api.layerWithFetch` builds the real
// Api on top of a fake `fetch` that answers with whatever the test says. The
// answers are written the way the server sends them (try `curl` against a
// local server, see the README): an error is JSON with its `_tag` and the
// student's sentence.

const email = "student@oregonstate.edu"
const token = "token-of-this-browser"
const intro = { term: "202702", crn: "33940" }
const introAlert = { ...intro, title: "INTRO TO COMPUTER SCIENCE I" }

/** A `Response` like the server's: a status and a JSON body. */
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The server's answer to a successful call that returns nothing. */
const noContent = () => new Response(null, { status: 204 })

/** A refusal, as the server sends it. */
const refusal = (status: number, tag: string) => jsonResponse(status, { _tag: tag, message: `The sentence for ${tag}.` })

/** Build a fake `fetch`, and keep a list of the requests it received. */
function fakeFetch(respond: () => Response) {
  const requests: Array<Request> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init))
    return respond()
  }
  return { fetch, requests }
}

/** Run one Api call against a server that always gives the same answer. */
const callApi = <A, E>(respond: () => Response, call: (api: Api["Service"]) => Effect.Effect<A, E>) =>
  Api.use(call).pipe(Effect.provide(Api.layerWithFetch(fakeFetch(respond).fetch)))

/** The same, for a call that is expected to fail: succeeds with the error. */
const callApiError = <A, E>(respond: () => Response, call: (api: Api["Service"]) => Effect.Effect<A, E>) =>
  Effect.flip(callApi(respond, call))

/** Every call, with a reply that makes it succeed. */
const everyCall: ReadonlyArray<{
  readonly name: string
  readonly call: (api: Api["Service"]) => Effect.Effect<unknown, AppError | { readonly _tag: string }>
  readonly success: () => Response
}> = [
  { name: "sendCode", call: (api) => api.sendCode(email), success: noContent },
  { name: "signIn", call: (api) => api.signIn(email, "012345"), success: () => jsonResponse(200, { token }) },
  { name: "signOut", call: (api) => api.signOut(token), success: noContent },
  { name: "deleteAccount", call: (api) => api.deleteAccount(token), success: noContent },
  { name: "listAlerts", call: (api) => api.listAlerts(token), success: () => jsonResponse(200, [introAlert]) },
  { name: "subscribe", call: (api) => api.subscribe(token, intro), success: () => jsonResponse(200, introAlert) },
  { name: "unsubscribe", call: (api) => api.unsubscribe(token, intro), success: noContent }
]

describe("requests", () => {
  /** Run a call against a server that answers `reply`, and return the single request it made. */
  const requestOf = <A, E>(call: (api: Api["Service"]) => Effect.Effect<A, E>, reply: () => Response) =>
    Effect.gen(function*() {
      const fake = fakeFetch(reply)
      yield* Api.use(call).pipe(Effect.provide(Api.layerWithFetch(fake.fetch)))
      assert.strictEqual(fake.requests.length, 1)
      return fake.requests[0]!
    })

  /** What a request carried: method, URL, sign-in token and JSON body. */
  const describeRequest = (request: Request) =>
    Effect.promise(async () => {
      const text = await request.text()
      return {
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: text === "" ? undefined : JSON.parse(text)
      }
    })

  it.effect("sendCode posts the email to /sign-in/code, without a token", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.sendCode(email), noContent)
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "POST",
        url: `${API_BASE_URL}/sign-in/code`,
        authorization: null,
        body: { email }
      })
    }))

  it.effect("signIn posts the email and code to /sign-in, without a token, and returns the token", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.signIn(email, "012345"), () => jsonResponse(200, { token }))
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "POST",
        url: `${API_BASE_URL}/sign-in`,
        authorization: null,
        body: { email, code: "012345" }
      })
      assert.strictEqual(yield* callApi(() => jsonResponse(200, { token }), (api) => api.signIn(email, "012345")), token)
    }))

  it.effect("signOut posts to /sign-out with the token", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.signOut(token), noContent)
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "POST",
        url: `${API_BASE_URL}/sign-out`,
        authorization: `Bearer ${token}`,
        body: undefined
      })
    }))

  it.effect("deleteAccount deletes /account with the token", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.deleteAccount(token), noContent)
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "DELETE",
        url: `${API_BASE_URL}/account`,
        authorization: `Bearer ${token}`,
        body: undefined
      })
    }))

  it.effect("listAlerts gets /alerts with the token, and returns the alerts", () =>
    Effect.gen(function*() {
      const reply = () => jsonResponse(200, [introAlert, { term: "202701", crn: "33940", title: "OTHER CLASS" }])
      const request = yield* requestOf((api) => api.listAlerts(token), reply)
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "GET",
        url: `${API_BASE_URL}/alerts`,
        authorization: `Bearer ${token}`,
        body: undefined
      })
      assert.deepStrictEqual(yield* callApi(reply, (api) => api.listAlerts(token)), [
        introAlert,
        { term: "202701", crn: "33940", title: "OTHER CLASS" }
      ])
    }))

  it.effect("subscribe posts the term and CRN to /alerts with the token, and returns the alert", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.subscribe(token, intro), () => jsonResponse(200, introAlert))
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "POST",
        url: `${API_BASE_URL}/alerts`,
        authorization: `Bearer ${token}`,
        body: { term: "202702", crn: "33940" }
      })
      assert.deepStrictEqual(
        yield* callApi(() => jsonResponse(200, introAlert), (api) => api.subscribe(token, intro)),
        introAlert
      )
    }))

  it.effect("unsubscribe deletes /alerts/<term>/<crn> with the token", () =>
    Effect.gen(function*() {
      const request = yield* requestOf((api) => api.unsubscribe(token, intro), noContent)
      assert.deepStrictEqual(yield* describeRequest(request), {
        method: "DELETE",
        url: `${API_BASE_URL}/alerts/202702/33940`,
        authorization: `Bearer ${token}`,
        body: undefined
      })
    }))

  it.effect.each(everyCall)("$name sends no header the server's CORS rules would refuse", ({ call, success }) =>
    Effect.gen(function*() {
      const request = yield* requestOf(call, success)
      // A browser sends nothing the server has not allowed in its answer to
      // the preflight (`Cors` in apps/server/src/server.ts). Tracing headers
      // (`traceparent`, `b3`) would make every call fail there.
      const allowed = ["authorization", "content-type"]
      assert.deepStrictEqual([...request.headers.keys()].filter((name) => !allowed.includes(name)), [])
    }))
})

describe("the server's refusals", () => {
  const refusals: ReadonlyArray<{
    readonly name: string
    readonly call: (api: Api["Service"]) => Effect.Effect<unknown, { readonly _tag: string; readonly message?: string }>
    readonly status: number
    readonly tag: string
  }> = [
    { name: "sendCode", call: (api) => api.sendCode(email), status: 429, tag: "CodeRecentlySent" },
    { name: "sendCode", call: (api) => api.sendCode(email), status: 503, tag: "EmailNotSent" },
    { name: "signIn", call: (api) => api.signIn(email, "012345"), status: 400, tag: "InvalidCode" },
    { name: "signOut", call: (api) => api.signOut(token), status: 401, tag: "NotSignedIn" },
    { name: "deleteAccount", call: (api) => api.deleteAccount(token), status: 401, tag: "NotSignedIn" },
    { name: "listAlerts", call: (api) => api.listAlerts(token), status: 401, tag: "NotSignedIn" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 401, tag: "NotSignedIn" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 409, tag: "AlreadySubscribed" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 404, tag: "ClassNotFound" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 409, tag: "TermNotOpen" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 409, tag: "AddDeadlinePassed" },
    { name: "subscribe", call: (api) => api.subscribe(token, intro), status: 502, tag: "UniversityUnavailable" },
    { name: "unsubscribe", call: (api) => api.unsubscribe(token, intro), status: 401, tag: "NotSignedIn" },
    { name: "unsubscribe", call: (api) => api.unsubscribe(token, intro), status: 404, tag: "NotSubscribed" }
  ]

  it.effect.each(refusals)("$name, HTTP $status: $tag, with the server's sentence", ({ call, status, tag }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => refusal(status, tag), call)
      assert.strictEqual(error._tag, tag)
      assert.strictEqual(error.message, `The sentence for ${tag}.`)
    }))
})

describe("problems every call can have", () => {
  it.effect.each(everyCall)("$name: the request cannot be sent (offline): NetworkError", ({ call }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => {
        throw new TypeError("Failed to fetch")
      }, call)
      assert.strictEqual(error._tag, "NetworkError")
    }))

  it.effect.each(everyCall)("$name: no answer within 30 seconds: NetworkError, and the request is given up", ({ call }) =>
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

  it.effect.each(everyCall)("$name: a status the API does not list (a crash, HTTP 500): ServerError", ({ call }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => new Response("Internal Server Error", { status: 500 }), call)
      assert.strictEqual(error._tag, "ServerError")
    }))

  it.effect("the bare HTTP 400 the server gives input its schemas refuse: ServerError", () =>
    Effect.gen(function*() {
      // The forms check what is typed first, so this means a bug.
      const error = yield* callApiError(() => new Response(null, { status: 400 }), (api) => api.sendCode(email))
      assert.strictEqual(error._tag, "ServerError")
    }))

  it.effect("a proxy's HTML error page: ServerError", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(
        () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
        (api) => api.subscribe(token, intro)
      )
      assert.strictEqual(error._tag, "ServerError")
    }))

  it.effect.each([
    { title: "not a list", body: { alerts: [] } },
    { title: "an alert without a title", body: [{ term: "202702", crn: "33940" }] },
    { title: "a CRN that is not digits", body: [{ term: "202702", crn: "abc", title: "X" }] },
    { title: "a term that is not six digits", body: [{ term: "2027", crn: "33940", title: "X" }] }
  ])("a reply of the wrong shape ($title): ServerError", ({ body }) =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => jsonResponse(200, body), (api) => api.listAlerts(token))
      assert.strictEqual(error._tag, "ServerError")
    }))

  it.effect("a refusal of a kind this call cannot get: ServerError", () =>
    Effect.gen(function*() {
      const error = yield* callApiError(() => refusal(409, "TermNotOpen"), (api) => api.unsubscribe(token, intro))
      assert.strictEqual(error._tag, "ServerError")
    }))
})
