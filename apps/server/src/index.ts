/**
 * The Worker: Cloudflare calls its `fetch` for every request.
 *
 * Effect turns the API (`Api.ts`) and its handlers into one plain function
 * from a `Request` to a `Response`, which is all a Worker's `fetch` needs.
 */
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "./Api"

const HelloHandlers = HttpApiBuilder.group(
  Api,
  "hello",
  (handlers) => handlers.handle("hello", () => Effect.succeed({ message: "Hello from GetTheDamClass" }))
)

// Built once, when Cloudflare loads the Worker, and then shared by every
// request it serves. The `dispose` this also returns is not needed: a Worker
// is never told it is about to stop.
const { handler } = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(HelloHandlers),
    // What Effect's HTTP server asks of the platform it runs on, such as
    // reading files to serve them. A Worker serves no files, so these simple
    // stand-ins (a file system that has none) are all it needs. Effect's
    // reference lists this layer under testing, but its own guide uses it for
    // web handlers like this one too.
    Layer.provide(HttpServer.layerServices)
  )
)

export default {
  fetch: (request) => handler(request)
} satisfies ExportedHandler
