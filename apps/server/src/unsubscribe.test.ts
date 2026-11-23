import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { INTRO_TO_CS, makeTestServer, type TestServer } from "../test/TestServer"

const subscribed = Effect.gen(function*() {
  const server = yield* makeTestServer()
  const api = yield* server.client(yield* server.signIn("student@oregonstate.edu"))
  yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
  const link = server.mailer.sent.at(-1)!.text.match(/https:\/\/\S+/)![0]
  return { server, api, link }
})

// A browser posts the page's form with `Origin: null`, because of its "no-referrer" policy.
const open = (server: TestServer, url: string, method = "GET") =>
  Effect.promise(async () => {
    const response = await server.fetch(url, { method, headers: method === "POST" ? { origin: "null" } : {} })
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      headers: response.headers,
      html: await response.text()
    }
  })

const assertPrivate = (headers: Headers) => {
  assert.strictEqual(headers.get("referrer-policy"), "no-referrer")
  assert.strictEqual(headers.get("cache-control"), "no-store")
  const policy = new Map(
    headers.get("content-security-policy")!.split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/)
      return [name!, values.join(" ")]
    })
  )
  assert.strictEqual(policy.get("default-src"), "'none'")
  assert.deepStrictEqual([...policy.keys()].filter((name) => name.startsWith("script-src")), [])
  assert.strictEqual(policy.get("style-src"), "'unsafe-inline'")
  assert.strictEqual(policy.get("form-action"), "'self'")
}

describe("the unsubscribe page", () => {
  it.effect("GET shows the class and a button, and stops nothing", () =>
    Effect.gen(function*() {
      const { server, api, link } = yield* subscribed
      const page = yield* open(server, link)
      assert.strictEqual(page.status, 200)
      assert.include(page.type, "text/html")
      assert.include(page.html, "INTRO TO COMPUTER SCIENCE I (CRN 33940)")
      assert.match(page.html, /<form method="post" action="\/unsubscribe\?key=[^"]+">/)
      assertPrivate(page.headers)
      yield* open(server, link)
      assert.strictEqual((yield* api.alerts.list()).length, 1)
    }))

  it.effect("the button (POST) stops the alert, and says so", () =>
    Effect.gen(function*() {
      const { server, api, link } = yield* subscribed
      const page = yield* open(server, link, "POST")
      assert.strictEqual(page.status, 200)
      assert.include(page.html, "Alerts stopped")
      assertPrivate(page.headers)
      assert.include(page.html, "INTRO TO COMPUTER SCIENCE I (CRN 33940)")
      assert.deepStrictEqual(yield* api.alerts.list(), [])
    }))

  it.effect("the button's form posts back to the same link", () =>
    Effect.gen(function*() {
      const { server, link } = yield* subscribed
      const page = yield* open(server, link)
      const action = page.html.match(/action="([^"]+)"/)![1]!.replaceAll("&amp;", "&")
      assert.strictEqual(new URL(action, link).href, link)
    }))

  it.effect("for an alert already stopped: a friendly page, for GET and POST alike", () =>
    Effect.gen(function*() {
      const { server, api, link } = yield* subscribed
      yield* api.alerts.unsubscribe({ params: INTRO_TO_CS })
      for (const method of ["GET", "POST"]) {
        const page = yield* open(server, link, method)
        assert.strictEqual(page.status, 404)
        assert.include(page.type, "text/html")
        assert.include(page.html, "already stopped")
        assertPrivate(page.headers)
      }
    }))

  it.effect("for a link without a key or with a made-up one: the same friendly page", () =>
    Effect.gen(function*() {
      const { server, api, link } = yield* subscribed
      for (const url of [new URL("/unsubscribe", link).href, new URL("/unsubscribe?key=made-up", link).href]) {
        const page = yield* open(server, url, "POST")
        assert.strictEqual(page.status, 404)
        assert.include(page.html, "already stopped")
        assertPrivate(page.headers)
      }
      assert.strictEqual((yield* api.alerts.list()).length, 1)
    }))

  it.effect("escapes the course title, on the page and in the email", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer({
        classes: { "202702/33940": { title: "C & C++ <ADVANCED>", seats: { enrolled: 1, capacity: 1 } } }
      })
      const api = yield* server.client(yield* server.signIn("student@oregonstate.edu"))
      yield* api.alerts.subscribe({ payload: INTRO_TO_CS })
      const email = server.mailer.sent.at(-1)!
      assert.include(email.html, "C &amp; C++ &lt;ADVANCED&gt;")
      const page = yield* open(server, email.text.match(/https:\/\/\S+/)![0])
      assert.include(page.html, "C &amp; C++ &lt;ADVANCED&gt;")
    }))
})
