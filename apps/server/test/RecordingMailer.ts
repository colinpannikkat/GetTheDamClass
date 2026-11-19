/**
 * The `Mailer` for tests: it sends nothing, and keeps every message so a test
 * can read it (to find a sign-in code, say). It can also be told to fail.
 */
import { Effect, Layer } from "effect"
import { type Email, Mailer, SendFailed } from "../src/Mailer"

export interface RecordingMailer {
  /** Every message sent so far, oldest first. Failed sends are not in it. */
  readonly sent: Array<Email>
  /** While this is set, every send fails with it as the reason. */
  failure: string | undefined
  readonly layer: Layer.Layer<Mailer>
}

export const makeRecordingMailer = (): RecordingMailer => {
  const mailer: RecordingMailer = {
    sent: [],
    failure: undefined,
    layer: Layer.succeed(Mailer, {
      send: (email) =>
        Effect.suspend(() => {
          if (mailer.failure !== undefined) {
            return Effect.fail(new SendFailed({ reason: mailer.failure }))
          }
          mailer.sent.push(email)
          return Effect.void
        })
    })
  }
  return mailer
}
