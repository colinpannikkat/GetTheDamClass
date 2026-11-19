/**
 * What the server answers, defined once with Effect's `HttpApi`: every
 * endpoint's method, path and the shape of its reply. Effect checks requests
 * and replies against these schemas, and can build a typed client from the
 * same definition.
 *
 * Nothing here runs on the server; the handlers are in `index.ts`. That
 * separation is what lets the extension use this definition too, once it
 * moves to a package both of them import.
 */
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

const Hello = Schema.Struct({ message: Schema.String })

// `topLevel` puts the group's endpoints at the root of a generated client:
// `client.hello()` rather than `client.hello.hello()`.
class HelloGroup extends HttpApiGroup.make("hello", { topLevel: true }).add(
  HttpApiEndpoint.get("hello", "/", { success: Hello })
) {}

export class Api extends HttpApi.make("getthedamclass").add(HelloGroup) {}
