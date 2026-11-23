import { Console, Context, Data, Effect, Layer } from "effect"

export interface Email {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

export class SendFailed extends Data.TaggedError("SendFailed")<{ readonly reason: string }> {}

export class Mailer extends Context.Service<Mailer, {
  send(email: Email): Effect.Effect<void, SendFailed>
}>()("getthedamclass/Mailer") {
  static readonly layerCloudflare = (binding: SendEmail, from: string) =>
    Layer.succeed(Mailer, {
      send: (email) =>
        Effect.tryPromise({
          try: () => binding.send({ from, ...email }),
          catch: (cause) => new SendFailed({ reason: cause instanceof Error ? cause.message : String(cause) })
        }).pipe(Effect.asVoid)
    })

  // Never in production: this is the one place a sign-in code is ever written out.
  static readonly layerPrint = Layer.succeed(Mailer, {
    send: (email) =>
      Console.log(
        [
          "--- Email (printed, not sent) ---",
          `To: ${email.to}`,
          `Subject: ${email.subject}`,
          "",
          email.text,
          "---------------------------------"
        ].join("\n")
      )
  })
}
