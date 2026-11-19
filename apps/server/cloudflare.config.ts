/**
 * The Worker's settings for Cloudflare: its name, its code, which version of
 * the Workers runtime it expects, when its jobs run, and its bindings (what
 * `env` holds in the code). `cf dev`, `cf build` and `cf deploy` all read this file. (It replaces
 * the `wrangler.toml` older projects have.)
 * See https://developers.cloudflare.com/cf/projects/cloudflare-config/
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
      env: {
        // TODO(production): the real database's ID goes here instead of
        // `undefined`, once it exists. Without one, `cf deploy` creates a new
        // database.
        DB: bindings.d1({ name: "getthedamclass", id: local ? LOCAL_DATABASE_ID : undefined }),
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
