import { Layer, ManagedRuntime } from "effect"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"

export type AppServices = Api | AccountStore

export const AppLayer: Layer.Layer<AppServices> = Layer.mergeAll(Api.layer, AccountStore.layer)

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>

export const runtime: AppRuntime = ManagedRuntime.make(AppLayer)
