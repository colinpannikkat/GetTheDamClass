/**
 * The one place where the real services are put together.
 *
 * A `Layer` is a recipe for building a service. A runtime is what you get once
 * the recipes have been followed: something that can run any effect needing
 * those services. Each entrypoint (popup, content script) imports `runtime`.
 */
import { Layer, ManagedRuntime } from "effect"
import { Api } from "./Api"
import { CredentialStore } from "./CredentialStore"

/** Every service the app's effects may use. */
export type AppServices = Api | CredentialStore

export const AppLayer: Layer.Layer<AppServices> = Layer.mergeAll(Api.layer, CredentialStore.layer)

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>

/**
 * Runs effects outside React, for example `runtime.runPromise(signOut)`.
 * Inside React components use the hooks in `lib/react.ts` instead.
 */
export const runtime: AppRuntime = ManagedRuntime.make(AppLayer)
