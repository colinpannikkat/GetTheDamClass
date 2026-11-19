/**
 * The whole server as one layer: the API from packages/shared with its
 * handlers, the unsubscribe page, and CORS.
 *
 * What it needs from outside is left open, so that the Worker (index.ts) and
 * the tests (test/TestServer.ts) can each supply their own:
 *
 *   SqlClient      the database (D1, or SQLite in tests)
 *   Mailer         sending email
 *   University     the university's class search
 *   PublicUrl      where links in emails point
 *   SecureRandom   randomness for codes, tokens and keys
 *
 * They must be given with `Layer.provideMerge`, not `Layer.provide`: the
 * handlers ask for them on each request, and only a merged layer keeps them
 * in what the router hands to requests.
 */
import { Api } from "@getthedamclass/shared/Api"
import { Layer } from "effect"
import { Digest } from "effect/crypto"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { AccountHandlers } from "./account"
import { AlertsHandlers } from "./alerts"
import { SignInHandlers } from "./signIn"
import { AuthenticationLive } from "./tokens"
import { UnsubscribePage } from "./unsubscribe"

const ApiRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([SignInHandlers, AccountHandlers, AlertsHandlers]),
  Layer.provide(AuthenticationLive)
)

/**
 * Lets the extension call the server from other origins: its own pages, and
 * its content script on https://classes.oregonstate.edu. Browsers first ask
 * (a "preflight" `OPTIONS` request) whether a call with an `Authorization`
 * header is allowed, and this answers yes. Any origin is allowed: nothing here
 * uses cookies, so a page on another site gains nothing it could not do
 * without a browser. Only a sign-in token opens an account, and a site cannot
 * read the one the extension keeps.
 */
const Cors = HttpRouter.cors({
  allowedHeaders: ["authorization", "content-type"],
  maxAge: 86_400
})

export const ServerLayer = Layer.mergeAll(ApiRoutes, UnsubscribePage, Cors).pipe(
  // Hashing, for codes and tokens. Merged for the same reason as above.
  Layer.provideMerge(Digest.layerWebCrypto),
  // What Effect's HTTP server asks of the platform it runs on, such as
  // reading files to serve them. A Worker serves no files, so these simple
  // stand-ins (a file system that has none) are all it needs. Effect's
  // reference lists this layer under testing, but its own guide uses it for
  // web handlers like this one too.
  Layer.provide(HttpServer.layerServices)
)
