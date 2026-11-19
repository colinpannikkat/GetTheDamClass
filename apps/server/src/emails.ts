/**
 * What every email says. Each function returns the subject and the body twice:
 * as plain text, and as simple HTML.
 *
 * The HTML uses inline `style` attributes and nothing else: most mail clients
 * drop `<style>` blocks and ignore CSS variables, so anything fancier comes
 * out differently in every inbox.
 */
import type { Crn } from "@getthedamclass/shared/domain"
import { ACCENT, classLabel, escapeHtml } from "./html"
import type { Email } from "./Mailer"

/** The HTML around every message. `body` is HTML already. */
const layout = (body: string) =>
  `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222222;">
<div style="max-width:560px;margin:0 auto;padding:24px;background-color:#ffffff;border-top:4px solid ${ACCENT};">
${body}
<p style="margin:24px 0 0;font-size:13px;color:#666666;">GetTheDamClass watches Oregon State classes for open seats.</p>
</div>
</body>
</html>`

const paragraph = (html: string) => `<p style="margin:0 0 16px;">${html}</p>`

const button = (href: string, label: string) =>
  `<p style="margin:0 0 16px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background-color:${ACCENT};color:#ffffff;text-decoration:none;font-weight:bold;border-radius:4px;">${
    escapeHtml(label)
  }</a></p>`

/** The six-digit code that signs a student in. */
export const signInCodeEmail = (to: string, code: string): Email => ({
  to,
  subject: `Your GetTheDamClass code: ${code}`,
  text: [
    `Your sign-in code is ${code}`,
    "",
    "Type it into the GetTheDamClass extension. It works once, for 15 minutes.",
    "",
    "If you did not ask for it, you can ignore this email."
  ].join("\n"),
  html: layout(
    paragraph("Your sign-in code is") +
      `<p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:4px;">${escapeHtml(code)}</p>` +
      paragraph("Type it into the GetTheDamClass extension. It works once, for 15 minutes.") +
      paragraph("If you did not ask for it, you can ignore this email.")
  )
})

/** Sent right after a student starts alerts for a class. */
export const subscriptionConfirmedEmail = (to: string, alert: {
  readonly title: string
  readonly crn: Crn
  readonly unsubscribeUrl: string
}): Email => {
  const label = classLabel(alert)
  return {
    to,
    subject: `Watching ${alert.title} for open seats`,
    text: [
      `You will get an email when a seat opens in ${label}, and another if it fills up again.`,
      "",
      "To stop these alerts, use the extension or open this link:",
      alert.unsubscribeUrl
    ].join("\n"),
    html: layout(
      paragraph(`You will get an email when a seat opens in <strong>${escapeHtml(label)}</strong>, and another if it fills up again.`) +
        paragraph("To stop these alerts, use the extension or this button:") +
        button(alert.unsubscribeUrl, "Stop these alerts")
    )
  }
}
