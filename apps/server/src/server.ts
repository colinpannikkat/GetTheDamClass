// Its services must be given with `Layer.provideMerge`, not `Layer.provide`: the handlers ask for them
// on each request, and only a merged layer keeps them in what the router hands to requests.
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

// Any origin: nothing uses cookies, and only a sign-in token, which a site cannot read, opens an account.
const Cors = HttpRouter.cors({
  allowedHeaders: ["authorization", "content-type"],
  maxAge: 86_400
})

export const ServerLayer = Layer.mergeAll(ApiRoutes, UnsubscribePage, Cors).pipe(
  Layer.provideMerge(Digest.layerWebCrypto),
  Layer.provide(HttpServer.layerServices)
)
