/**
 * Sending email, as an Effect service.
 *
 * There are three implementations:
 *
 * - `Mailer.layerCloudflare` sends through Cloudflare Email Sending. This is
 *   the one in production.
 * - `Mailer.layerPrint` prints every message to the terminal and sends
 *   nothing. It is for `pnpm dev`, where the sign-in code is read from the
 *   terminal. `src/index.ts` only picks it when cloudflare.config.ts says so,
 *   and that file only says so in "development" mode, the one `cf dev` uses.
 * - `RecordingMailer` (in test/) keeps the messages for tests to look at.
 *
 * Every email goes to one student. What the emails say is in `emails.ts`.
 */
import { Console, Context, Data, Effect, Layer } from "effect"

/** One message, ready to send. */
export interface Email {
  readonly to: string
  readonly subject: string
  /** The message as plain text, for mail clients that show no HTML. */
  readonly text: string
  /** The same message as simple HTML. */
  readonly html: string
}

/** A message could not be sent. `reason` says why, in the sender's words. */
export class SendFailed extends Data.TaggedError("SendFailed")<{ readonly reason: string }> {}

export class Mailer extends Context.Service<Mailer, {
  send(email: Email): Effect.Effect<void, SendFailed>
}>()("getthedamclass/Mailer") {
  /**
   * The real implementation, on the Worker's send-email binding (`EMAIL` in
   * cloudflare.config.ts). `from` must be one of the binding's allowed sender
   * addresses.
   */
  static readonly layerCloudflare = (binding: SendEmail, from: string) =>
    Layer.succeed(Mailer, {
      send: (email) =>
        Effect.tryPromise({
          try: () => binding.send({ from, ...email }),
          catch: (cause) => new SendFailed({ reason: cause instanceof Error ? cause.message : String(cause) })
        }).pipe(Effect.asVoid)
    })

  /**
   * For local development only: prints the message instead of sending it.
   * This is the one place a sign-in code is ever written out, which is why
   * it must never run in production.
   */
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
