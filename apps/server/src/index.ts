/**
 * The Worker: Cloudflare calls its `fetch` for every request, and its
 * `scheduled` for every run of a cron trigger (the check every minute and the
 * daily job; see scheduled.ts).
 *
 * This file only plugs the server (server.ts) and the jobs (scheduled.ts)
 * into Cloudflare: the database, email and settings come from the bindings in
 * cloudflare.config.ts, which `env` from "cloudflare:workers" holds. Effect
 * turns the server into one plain function from a `Request` to a `Response`,
 * which is all a Worker's `fetch` needs, and runs the jobs on the same
 * services.
 */
import { env } from "cloudflare:workers"
import { Layer, ManagedRuntime, Scheduler } from "effect"
import { SecureRandom } from "effect/crypto"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { layerD1 } from "./database"
import { Mailer } from "./Mailer"
import { runScheduled } from "./scheduled"
import { ServerLayer } from "./server"
import { SignInEmailsPerDay } from "./signIn"
import { University } from "./University"
import { PublicUrl } from "./unsubscribe"

const Dependencies = Layer.mergeAll(
  layerD1(env.DB),
  // "print" is only set in "development" mode, which `cf dev` uses (see
  // cloudflare.config.ts); a build in the default "production" mode always
  // sends for real.
  env.MAILER === "print" ? Mailer.layerPrint : Mailer.layerCloudflare(env.EMAIL, env.EMAIL_FROM),
  University.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  Layer.succeed(PublicUrl, env.PUBLIC_URL),
  Layer.succeed(SignInEmailsPerDay, env.SIGN_IN_EMAILS_PER_DAY),
  SecureRandom.layerWebCrypto
)

/**
 * Effect's default scheduler hands work on with timers. In a Worker, work
 * started while serving one request belongs to that request, so a fiber that
 * several requests share (such as the database client's cache of prepared
 * statements) can stall when another request is the one waiting for it. Running
 * scheduled work synchronously avoids that; it is the fix Effect's
 * documentation of `HttpRouter.toWebHandler` gives for Workers. (Effect's
 * "scheduler" is unrelated to cron: it decides when a fiber's next step runs.)
 */
const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))

/** Everything both handlers run on. */
const Services = Dependencies.pipe(Layer.provideMerge(SyncScheduler))

// Both are built once, when first used, and then shared by every request and
// cron run. Handing the server the jobs' `memoMap` makes it reuse the
// services the jobs built, and the other way round, instead of building a
// second database client. Neither needs disposing: a Worker is never told it
// is about to stop.
const jobs = ManagedRuntime.make(Services)
const { handler } = HttpRouter.toWebHandler(ServerLayer.pipe(Layer.provideMerge(Services)), {
  memoMap: jobs.memoMap
})

export default {
  fetch: (request, _env, ctx) => {
    const response = handler(request)
    // When the client goes away before the answer (the extension's popup
    // closes the moment the student switches to their inbox), Cloudflare may
    // stop the work of that request where it is, unless it was handed to
    // `waitUntil`, which gives it up to 30 seconds more. So hand it the whole
    // handler: `sendCode` (signIn.ts) then gets those 30 seconds to send the
    // email or forget the code. For a request answered normally this changes
    // nothing: its handler is done by the time the response goes out.
    ctx.waitUntil(response)
    return response
  },
  // Cloudflare waits for the promise, and counts a rejected one as a failed run.
  scheduled: (controller) => jobs.runPromise(runScheduled(controller.cron))
} satisfies ExportedHandler
