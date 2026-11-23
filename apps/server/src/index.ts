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
  env.MAILER === "print" ? Mailer.layerPrint : Mailer.layerCloudflare(env.EMAIL, env.EMAIL_FROM),
  University.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  Layer.succeed(PublicUrl, env.PUBLIC_URL),
  Layer.succeed(SignInEmailsPerDay, env.SIGN_IN_EMAILS_PER_DAY),
  SecureRandom.layerWebCrypto
)

// The default scheduler uses timers, and in a Worker a fiber shared by requests can then stall.
// Running scheduled work synchronously is the fix Effect gives for Workers (`HttpRouter.toWebHandler`).
const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))

const Services = Dependencies.pipe(Layer.provideMerge(SyncScheduler))

// Sharing the `memoMap` makes the server and the jobs reuse one set of services (one database client).
const jobs = ManagedRuntime.make(Services)
const { handler } = HttpRouter.toWebHandler(ServerLayer.pipe(Layer.provideMerge(Services)), {
  memoMap: jobs.memoMap
})

export default {
  fetch: (request, _env, ctx) => {
    const response = handler(request)
    // Cloudflare may stop a request's work when the client goes away (the popup closes) unless it is in
    // `waitUntil`: this gives `sendCode` time to send the email or forget the code.
    ctx.waitUntil(response)
    return response
  },
  scheduled: (controller) => jobs.runPromise(runScheduled(controller.cron))
} satisfies ExportedHandler
