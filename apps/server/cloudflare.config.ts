/**
 * The Worker's settings for Cloudflare: its name, its code, which version of
 * the Workers runtime it expects, when its jobs run, and its bindings (what
 * `env` holds in the code). `cf dev`, `cf build` and `cf deploy` all read
 * this file. (It replaces the `wrangler.toml` older projects have.) See
 * https://developers.cloudflare.com/cf/projects/cloudflare-config/
 *
 * The settings depend on the mode: `cf dev` runs in "development", and
 * `cf build` and `cf deploy` in "production".
 */
import { bindings, defineConfig, triggers } from "cf/config"

/** The address every email comes from. Cloudflare only sends from addresses listed on the binding. */
const SENDER = "alerts@getthedamclass.ajinkya.dev"

/**
 * The local database `cf dev` uses. Any valid UUID works; it only names the
 * file the local simulation keeps under .cloudflare/state. The "dev" script in
 * package.json applies the migrations to the same ID, so change both together.
 */
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000"

/**
 * The real database, "getthedamclass" on Cloudflare (see "Deployment" in the
 * README). Without an ID here, `cf deploy` would create a new, empty one.
 */
const PRODUCTION_DATABASE_ID = "8ec9fdcd-620b-414f-b468-8278130c41d0"

export default defineConfig(({ mode }) => {
  const local = mode === "development"
  return {
    worker: {
      name: "getthedamclass",
      entrypoint: "./src/index.ts",
      // Cloudflare updates the Workers runtime all the time. Changes that could
      // break existing code are switched on by date, and a Worker only gets the
      // ones dated on or before this. Move it forward on purpose, and test.
      compatibilityDate: "2026-11-17",
      // The check every minute and the daily job, written out as in
      // src/scheduled.ts, which says why at these times (scheduled.test.ts
      // checks that the two agree). They cannot be imported from there:
      // Cloudflare's Vite plugin keeps every file this config imports away
      // from the Worker. Locally they do not run by themselves; see "Running
      // the server" in the README.
      triggers: [triggers.scheduled({ schedule: "* * * * *" }), triggers.scheduled({ schedule: "0 11 * * *" })],
      // The API's one public address, which the extension's normal build
      // calls. Cloudflare creates its DNS record and certificate on deploy.
      domains: ["api.getthedamclass.ajinkya.dev"],
      // Off, so that the API answers at that address only, and not also at
      // getthedamclass.<account>.workers.dev or at a workers.dev address per
      // uploaded version. The rate limit on signing in (see the README) is
      // set on that address, and would not apply to the others.
      workersDev: false,
      previewUrls: false,
      // Workers Logs keeps what the server logs for 7 days (how to read it:
      // "Deployment" in the README). The server's own lines are what matter:
      // one per request (method, path without the query, status), one per
      // check and cleanup run with its counts, and every email that could not
      // be sent, with the reason. Cloudflare's own line per request (its
      // "invocation log") is off: it would also keep each request's headers,
      // query string (an unsubscribe link's key) and the client's IP
      // address, none of which the privacy policy says are kept.
      observability: { enabled: true, logs: { invocationLogs: false } },
      env: {
        DB: bindings.d1({ name: "getthedamclass", id: local ? LOCAL_DATABASE_ID : PRODUCTION_DATABASE_ID }),
        EMAIL: bindings.sendEmail({ allowedSenderAddresses: [SENDER] }),
        EMAIL_FROM: bindings.text(SENDER),
        // Where links in emails point.
        PUBLIC_URL: bindings.text(local ? "http://localhost:5173" : "https://api.getthedamclass.ajinkya.dev"),
        // "print" makes the server print emails to the terminal instead of
        // sending them (`Mailer.layerPrint`), so a sign-in code can be read
        // there. Only "development" mode sets it. `cf dev` runs in that mode;
        // `cf build` and `cf deploy` only do when told to with a flag
        // (`-m development`), which a real deploy must never be given.
        MAILER: bindings.text(local ? "print" : "cloudflare")
      }
    }
  }
})
