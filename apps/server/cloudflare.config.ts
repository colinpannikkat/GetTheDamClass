// "development" mode gets its own Worker name and no domain, so deploying it by mistake cannot touch the real one.
import { bindings, defineConfig, triggers } from "cf/config"

const SENDER = "alerts@getthedamclass.ajinkya.dev"

// Only names the local simulation's file. The "dev" script in package.json uses the same ID: change both together.
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000"

// Without an ID here, `cf deploy` would create a new, empty database.
const PRODUCTION_DATABASE_ID = "8ec9fdcd-620b-414f-b468-8278130c41d0"

export default defineConfig(({ mode }) => {
  const local = mode === "development"
  return {
    worker: {
      name: local ? "getthedamclass-local" : "getthedamclass",
      entrypoint: "./src/index.ts",
      compatibilityDate: "2026-11-17",
      // Same as in src/scheduled.ts (scheduled.test.ts checks they agree). Not imported: Cloudflare's
      // Vite plugin keeps every file this config imports out of the Worker.
      triggers: [triggers.scheduled({ schedule: "* * * * *" }), triggers.scheduled({ schedule: "0 11 * * *" })],
      domains: local ? [] : ["api.getthedamclass.ajinkya.dev"],
      // Off so the API answers only at the domain above, where the sign-in rate limit is set.
      workersDev: false,
      previewUrls: false,
      observability: {
        enabled: true,
        // So an unsubscribe link's key (`?key=...`) is never stored in the logs.
        redactQueryString: true,
        // Cloudflare's invocation log would also keep headers and client IPs, which the privacy policy does not allow.
        logs: { invocationLogs: false }
      },
      env: {
        DB: local
          ? bindings.d1({ name: "getthedamclass-local", id: LOCAL_DATABASE_ID })
          : bindings.d1({ name: "getthedamclass", id: PRODUCTION_DATABASE_ID }),
        EMAIL: bindings.sendEmail({ allowedSenderAddresses: [SENDER] }),
        EMAIL_FROM: bindings.text(SENDER),
        PUBLIC_URL: bindings.text(local ? "http://localhost:5173" : "https://api.getthedamclass.ajinkya.dev"),
        MAILER: bindings.text(local ? "print" : "cloudflare"),
        // About a third of the account's daily email limit (1,000), not half: the cap's UTC day and Cloudflare's
        // day do not line up, so a flood can take the cap twice in one of Cloudflare's days.
        SIGN_IN_EMAILS_PER_DAY: bindings.json(local ? 1_000_000 : 330)
      }
    }
  }
})
