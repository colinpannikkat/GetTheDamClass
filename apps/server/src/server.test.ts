import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeTestServer, PUBLIC_URL } from "../test/TestServer"

// What a browser sees when the extension calls the server from another
// origin: from its own pages, and from its content script on the class
// search. The extension has no host permissions, so these are ordinary
// cross-origin requests to the browser.

const origins = ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "https://classes.oregonstate.edu"]

describe("CORS", () => {
  it.effect.each(origins)("answers the preflight for a call with a token from %s", (origin) =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const response = yield* Effect.promise(() =>
        server.fetch(`${PUBLIC_URL}/alerts/202702/33940`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "DELETE",
            "access-control-request-headers": "authorization, content-type"
          }
        })
      )
      assert.strictEqual(response.status, 204)
      assert.strictEqual(response.headers.get("access-control-allow-origin"), "*")
      assert.include(response.headers.get("access-control-allow-methods"), "DELETE")
      assert.include(response.headers.get("access-control-allow-headers"), "authorization")
      assert.include(response.headers.get("access-control-allow-headers"), "content-type")
    }))

  it.effect("lets the page read the answer, errors included", () =>
    Effect.gen(function*() {
      const server = yield* makeTestServer()
      const response = yield* Effect.promise(() =>
        server.fetch(`${PUBLIC_URL}/alerts`, { headers: { origin: "https://classes.oregonstate.edu" } })
      )
      assert.strictEqual(response.status, 401)
      assert.strictEqual(response.headers.get("access-control-allow-origin"), "*")
    }))
})
