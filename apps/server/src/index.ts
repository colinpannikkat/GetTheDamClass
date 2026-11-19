/**
 * The Worker: Cloudflare calls its `fetch` for every request.
 *
 * This file only plugs the server (server.ts) into Cloudflare: the database,
 * email and settings come from the bindings in cloudflare.config.ts, which
 * `env` from "cloudflare:workers" holds. Effect turns the result into one
 * plain function from a `Request` to a `Response`, which is all a Worker's
 * `fetch` needs.
 */
import { env } from "cloudflare:workers"
import { Layer, Scheduler } from "effect"
import { SecureRandom } from "effect/crypto"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { layerD1 } from "./database"
import { Mailer } from "./Mailer"
import { ServerLayer } from "./server"
import { University } from "./University"
import { PublicUrl } from "./unsubscribe"

const Dependencies = Layer.mergeAll(
  layerD1(env.DB),
  // "print" is only ever set for `cf dev` (see cloudflare.config.ts); a build
  // for production always sends for real.
  env.MAILER === "print" ? Mailer.layerPrint : Mailer.layerCloudflare(env.EMAIL, env.EMAIL_FROM),
  University.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  Layer.succeed(PublicUrl, env.PUBLIC_URL),
  SecureRandom.layerWebCrypto
)

/**
 * Effect's default scheduler hands work on with timers. In a Worker, work
 * started while serving one request belongs to that request, so a fiber that
 * several requests share (such as the database client's cache of prepared
 * statements) can stall when another request is the one waiting for it. Running
 * scheduled work synchronously avoids that; it is the fix Effect's
 * documentation of `HttpRouter.toWebHandler` gives for Workers.
 */
const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))

// Built once, when Cloudflare loads the Worker, and then shared by every
// request it serves. The `dispose` this also returns is not needed: a Worker
// is never told it is about to stop.
const { handler } = HttpRouter.toWebHandler(
  ServerLayer.pipe(Layer.provideMerge(Dependencies), Layer.provideMerge(SyncScheduler))
)

export default {
  fetch: (request) => handler(request)
} satisfies ExportedHandler
