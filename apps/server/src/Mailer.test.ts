import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestConsole } from "effect/testing"
import { type Email, Mailer } from "./Mailer"

const email: Email = {
  to: "student@oregonstate.edu",
  subject: "Your GetTheDamClass code: 123456",
  text: "Your sign-in code is 123456",
  html: "<p>Your sign-in code is 123456</p>"
}

/** A stand-in for Cloudflare's send-email binding that keeps what it was given. */
const fakeBinding = (send: (message: unknown) => Promise<EmailSendResult>) => {
  const received: Array<unknown> = []
  const binding = {
    send: (message: unknown) => {
      received.push(message)
      return send(message)
    }
  } as SendEmail
  return { binding, received }
}

describe("layerCloudflare", () => {
  it.effect("hands the message to the binding, from the sender address", () =>
    Effect.gen(function*() {
      const fake = fakeBinding(() => Promise.resolve({ messageId: "1" }))
      yield* Mailer.use((mailer) => mailer.send(email)).pipe(
        Effect.provide(Mailer.layerCloudflare(fake.binding, "alerts@example.com"))
      )
      assert.deepStrictEqual(fake.received, [{ from: "alerts@example.com", ...email }])
    }))

  it.effect("a failed send is SendFailed, with the binding's reason", () =>
    Effect.gen(function*() {
      const fake = fakeBinding(() => Promise.reject(new Error("destination address is not verified")))
      const error = yield* Effect.flip(
        Mailer.use((mailer) => mailer.send(email)).pipe(
          Effect.provide(Mailer.layerCloudflare(fake.binding, "alerts@example.com"))
        )
      )
      assert.strictEqual(error._tag, "SendFailed")
      assert.strictEqual(error.reason, "destination address is not verified")
    }))
})

describe("layerPrint", () => {
  it.effect("prints the recipient, subject and text, so a code can be read from the terminal", () =>
    Effect.gen(function*() {
      yield* Mailer.use((mailer) => mailer.send(email)).pipe(Effect.provide(Mailer.layerPrint))
      const printed = (yield* TestConsole.logLines).join("\n")
      assert.include(printed, "To: student@oregonstate.edu")
      assert.include(printed, "Subject: Your GetTheDamClass code: 123456")
      assert.include(printed, "Your sign-in code is 123456")
    }))
})
