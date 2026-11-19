/**
 * The `Mailer` for tests: it sends nothing, and keeps every message so a test
 * can read it (to find a sign-in code, say). It can also be told to fail, for
 * every message or for some addresses.
 */
import { Effect, Layer } from "effect"
import { type Email, Mailer, SendFailed } from "../src/Mailer"

export interface RecordingMailer {
  /** Every message sent so far, oldest first. Failed sends are not in it. */
  readonly sent: Array<Email>
  /** While this is set, every send fails with it as the reason. */
  failure: string | undefined
  /** Sends to these addresses fail, with the reason given. */
  readonly failingAddresses: Map<string, string>
  readonly layer: Layer.Layer<Mailer>
}

export const makeRecordingMailer = (): RecordingMailer => {
  const mailer: RecordingMailer = {
    sent: [],
    failure: undefined,
    failingAddresses: new Map(),
    layer: Layer.succeed(Mailer, {
      send: (email) =>
        Effect.suspend(() => {
          const failure = mailer.failure ?? mailer.failingAddresses.get(email.to)
          if (failure !== undefined) {
            return Effect.fail(new SendFailed({ reason: failure }))
          }
          mailer.sent.push(email)
          return Effect.void
        })
    })
  }
  return mailer
}
