import { assert, it } from "@effect/vitest"
import worker from "./index"

// These tests call the Worker's `fetch` directly, the way Cloudflare does, but
// in Node: no Workers runtime and no network.

it("answers GET / with a JSON hello", async () => {
  const response = await worker.fetch(new Request("http://localhost/"))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(response.headers.get("Content-Type"), "application/json")
  assert.deepStrictEqual(await response.json(), { message: "Hello from GetTheDamClass" })
})
