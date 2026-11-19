/**
 * The one place where the real services are put together.
 *
 * A `Layer` is a recipe for building a service. A runtime is what you get once
 * the recipes have been followed: something that can run any effect needing
 * those services. The hooks in `lib/react.ts` use it by default.
 */
import { Layer, ManagedRuntime } from "effect"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"

/** Every service the app's effects may use. */
export type AppServices = Api | AccountStore

export const AppLayer: Layer.Layer<AppServices> = Layer.mergeAll(Api.layer, AccountStore.layer)

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>

export const runtime: AppRuntime = ManagedRuntime.make(AppLayer)
