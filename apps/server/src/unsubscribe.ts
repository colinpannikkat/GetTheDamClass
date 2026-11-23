// Opening the link changes nothing on purpose: mail scanners open links by themselves, so only the
// button's POST stops the alert. The key is in the query string because the logs leave it out.
import type { Crn } from "@getthedamclass/shared/domain"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { ACCENT, classLabel, escapeHtml } from "./html"

export class PublicUrl extends Context.Service<PublicUrl, string>()("getthedamclass/PublicUrl") {}

export const unsubscribeUrl = (key: string) =>
  PublicUrl.use((base) => Effect.succeed(new URL(`/unsubscribe?key=${encodeURIComponent(key)}`, base).href))

const findAlert = Effect.fn("unsubscribe.findAlert")(function*(key: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ title: string; crn: Crn }>`
    SELECT classes.title AS title, alerts.crn AS crn
    FROM alerts JOIN classes ON classes.term = alerts.term AND classes.crn = alerts.crn
    WHERE alerts.unsubscribe_key = ${key}
  `
  return rows[0]
}, dieOnSqlError)

const deleteAlert = Effect.fn("unsubscribe.deleteAlert")(function*(key: string) {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM alerts WHERE unsubscribe_key = ${key}`
}, dieOnSqlError)

const requestKey = Effect.map(HttpServerRequest.ParsedSearchParams, (params) => {
  const key = params["key"]
  return typeof key === "string" ? key : ""
})

const showConfirmation = Effect.fn("unsubscribe.showConfirmation")(function*(key: string) {
  const alert = yield* findAlert(key)
  if (alert === undefined) {
    return alreadyStoppedPage
  }
  return page(
    200,
    "Stop alerts?",
    `<p>Stop the open-seat emails for <strong>${escapeHtml(classLabel(alert))}</strong>?</p>
<form method="post" action="/unsubscribe?key=${escapeHtml(encodeURIComponent(key))}">
<button type="submit" style="padding:12px 20px;border:0;border-radius:4px;background-color:${ACCENT};color:#ffffff;font-size:16px;font-weight:bold;cursor:pointer;">Stop alerts</button>
</form>`
  )
})

const stopAlert = Effect.fn("unsubscribe.stopAlert")(function*(key: string) {
  const alert = yield* findAlert(key)
  if (alert === undefined) {
    return alreadyStoppedPage
  }
  yield* deleteAlert(key)
  return page(
    200,
    "Alerts stopped",
    `<p>You won't get more emails about <strong>${escapeHtml(classLabel(alert))}</strong>.</p>
<p>To watch it again, use the GetTheDamClass extension on the class search.</p>`
  )
})

export const UnsubscribePage = Layer.mergeAll(
  HttpRouter.add("GET", "/unsubscribe", Effect.flatMap(requestKey, showConfirmation)),
  HttpRouter.add("POST", "/unsubscribe", Effect.flatMap(requestKey, stopAlert))
)

// The page's address holds the key, so nothing on it may send that address anywhere (Cloudflare can
// inject its Web Analytics script into any HTML page).
const PAGE_HEADERS = {
  "referrer-policy": "no-referrer",
  // `form-action` does not fall back to `default-src`.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "cache-control": "no-store"
}

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
    { status, contentType: "text/html", headers: PAGE_HEADERS }
  )

const alreadyStoppedPage = page(
  404,
  "Already stopped",
  `<p>These alerts are already stopped, so there is nothing more to do.</p>
<p>To watch a class again, use the GetTheDamClass extension on the class search.</p>`
)
