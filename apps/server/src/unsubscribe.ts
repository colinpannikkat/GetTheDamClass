/**
 * The unsubscribe link in emails, and the page it opens.
 *
 * The link works without signing in: its secret key (`unsubscribe_key` in
 * the `alerts` table) is the permission. It is a page for a person, not part
 * of the API in packages/shared:
 *
 *   GET  /unsubscribe?key=...   names the class, with a "Stop alerts" button
 *   POST /unsubscribe?key=...   (the button) stops the alert
 *
 * Opening the link changes nothing on purpose. Mail scanners and link
 * previewers open links in emails by themselves (Microsoft's Safe Links does
 * it for every OSU inbox), and that must not cost a student their alert. Only
 * a person pressing the button sends the POST.
 *
 * The key travels in the query string rather than the path because Effect's
 * request log leaves the query string out, and the key should not end up in
 * logs.
 */
import type { Crn } from "@getthedamclass/shared/domain"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { ACCENT, className, escapeHtml } from "./html"

/**
 * The address the server is reached at from outside, such as
 * "https://api.getthedamclass.ajinkya.dev". Links in emails start with it. It
 * comes from configuration (`PUBLIC_URL` in cloudflare.config.ts), not from
 * the request, because emails are also sent when no request is being served.
 */
export class PublicUrl extends Context.Service<PublicUrl, string>()("getthedamclass/PublicUrl") {}

/** The link that stops the alert with this key. */
export const unsubscribeUrl = (key: string) =>
  PublicUrl.use((base) => Effect.succeed(new URL(`/unsubscribe?key=${encodeURIComponent(key)}`, base).href))

/** The class an unsubscribe key belongs to, if its alert still exists. */
const findAlert = Effect.fn("unsubscribe.findAlert")(function*(key: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ title: string; crn: Crn }>`
    SELECT classes.title AS title, alerts.crn AS crn
    FROM alerts JOIN classes ON classes.term = alerts.term AND classes.crn = alerts.crn
    WHERE alerts.unsubscribe_key = ${key}
  `
  return rows[0]
}, dieOnSqlError)

/** Stop the alert with this key. */
const deleteAlert = Effect.fn("unsubscribe.deleteAlert")(function*(key: string) {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM alerts WHERE unsubscribe_key = ${key}`
}, dieOnSqlError)

/** The `key` in the query string, or "" without one (which matches no alert). */
const requestKey = Effect.map(HttpServerRequest.ParsedSearchParams, (params) => {
  const key = params["key"]
  return typeof key === "string" ? key : ""
})

/** The page the link opens: it names the class and asks. */
const showConfirmation = Effect.fn("unsubscribe.showConfirmation")(function*(key: string) {
  const alert = yield* findAlert(key)
  if (alert === undefined) {
    return alreadyStoppedPage
  }
  return page(
    200,
    "Stop alerts?",
    `<p>Stop the open-seat emails for <strong>${escapeHtml(className(alert))}</strong>?</p>
<form method="post" action="/unsubscribe?key=${escapeHtml(encodeURIComponent(key))}">
<button type="submit" style="padding:12px 20px;border:0;border-radius:4px;background-color:${ACCENT};color:#ffffff;font-size:16px;font-weight:bold;cursor:pointer;">Stop alerts</button>
</form>`
  )
})

/** What the button does: stops the alert, and says so. */
const stopAlert = Effect.fn("unsubscribe.stopAlert")(function*(key: string) {
  const alert = yield* findAlert(key)
  if (alert === undefined) {
    return alreadyStoppedPage
  }
  yield* deleteAlert(key)
  return page(
    200,
    "Alerts stopped",
    `<p>You won't get more emails about <strong>${escapeHtml(className(alert))}</strong>.</p>
<p>To watch it again, use the GetTheDamClass extension on the class search.</p>`
  )
})

/** The page and the button's POST, as routes for the server's router. */
export const UnsubscribePage = Layer.mergeAll(
  HttpRouter.add("GET", "/unsubscribe", Effect.flatMap(requestKey, showConfirmation)),
  HttpRouter.add("POST", "/unsubscribe", Effect.flatMap(requestKey, stopAlert))
)

/** A small page of its own. `body` is HTML already. */
const page = (status: number, title: string, body: string) =>
  HttpServerResponse.text(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - GetTheDamClass</title>
</head>
<body style="margin:0;padding:24px;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222222;">
<main style="max-width:560px;margin:0 auto;padding:24px;background-color:#ffffff;border-top:4px solid ${ACCENT};">
<h1 style="margin:0 0 16px;font-size:24px;">${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`,
    { status, contentType: "text/html" }
  )

/**
 * For a key whose alert is gone: stopped already (with this link, in the
 * extension, or by deleting the account), or a link that was never right.
 */
const alreadyStoppedPage = page(
  404,
  "Already stopped",
  `<p>These alerts are already stopped, so there is nothing more to do.</p>
<p>To watch a class again, use the GetTheDamClass extension on the class search.</p>`
)
