import { Effect, Layer } from "effect"
import { type Email, Mailer, SendFailed } from "../src/Mailer"

export interface RecordingMailer {
  readonly sent: Array<Email>
  failure: string | undefined
  readonly failingAddresses: Map<string, string>
  beforeSend: Effect.Effect<void> | undefined
  readonly layer: Layer.Layer<Mailer>
}

export const makeRecordingMailer = (): RecordingMailer => {
  const mailer: RecordingMailer = {
    sent: [],
    failure: undefined,
    failingAddresses: new Map(),
    beforeSend: undefined,
    layer: Layer.succeed(Mailer, {
      send: (email) =>
        Effect.gen(function*() {
          yield* mailer.beforeSend ?? Effect.void
          const failure = mailer.failure ?? mailer.failingAddresses.get(email.to)
          if (failure !== undefined) {
            return yield* new SendFailed({ reason: failure })
          }
          mailer.sent.push(email)
        })
    })
  }
  return mailer
}
