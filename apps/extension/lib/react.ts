import { Cause, Effect, Exit, Option, Stream } from "effect"
import * as React from "react"
import { AccountStore, type Saved } from "./AccountStore"
import { type StorageError, UnexpectedError } from "./domain"
import { type AppRuntime, type AppServices, runtime as liveRuntime } from "./runtime"

export type Settled<A, E> =
  | { readonly status: "success"; readonly value: A }
  | { readonly status: "failure"; readonly error: E | UnexpectedError }

export type QueryState<A, E> = { readonly status: "loading" } | Settled<A, E>

export type ActionState<A, E> = { readonly status: "idle" } | { readonly status: "loading" } | Settled<A, E>

export type AccountState =
  | { readonly status: "loading" }
  | Saved
  | { readonly status: "failure"; readonly error: StorageError | UnexpectedError }

export const RuntimeContext = React.createContext<AppRuntime>(liveRuntime)

async function settle<A, E>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, E, AppServices>,
  signal?: AbortSignal
): Promise<Settled<A, E>> {
  const exit = await runtime.runPromiseExit(effect, { signal })
  if (Exit.isSuccess(exit)) {
    return { status: "success", value: exit.value }
  }
  const typedError = Exit.findErrorOption(exit)
  return {
    status: "failure",
    error: Option.isSome(typedError) ? typedError.value : new UnexpectedError({ cause: Cause.squash(exit.cause) })
  }
}

export function useQuery<A, E>(
  makeEffect: () => Effect.Effect<A, E, AppServices>,
  deps: ReadonlyArray<unknown>
): { readonly state: QueryState<A, E>; readonly reload: () => void } {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<QueryState<A, E>>({ status: "loading" })
  const [reloadCount, setReloadCount] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    setState({ status: "loading" })
    void settle(runtime, makeEffect(), controller.signal).then((settled) => {
      if (!controller.signal.aborted) {
        setState(settled)
      }
    })
    return () => controller.abort()
    // `makeEffect` is left out on purpose: callers pass a new function every render.
  }, [runtime, reloadCount, ...deps])

  const reload = React.useCallback(() => setReloadCount((count) => count + 1), [])
  return { state, reload }
}

export function useAction<Args extends ReadonlyArray<unknown>, A, E>(
  action: (...args: Args) => Effect.Effect<A, E, AppServices>
): {
  readonly state: ActionState<A, E>
  readonly run: (...args: Args) => Promise<Settled<A, E>>
} {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<ActionState<A, E>>({ status: "idle" })

  // Unlike a query, an action is not aborted when the component goes away.
  const run = React.useCallback(async (...args: Args) => {
    setState({ status: "loading" })
    const settled = await settle(runtime, action(...args))
    setState(settled)
    return settled
  }, [runtime, action])
  return { state, run }
}

export function useAccount(): AccountState {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<AccountState>({ status: "loading" })

  React.useEffect(() => {
    const controller = new AbortController()
    const followStore = Effect.gen(function*() {
      const store = yield* AccountStore
      yield* Stream.runForEach(store.changes, (saved) => Effect.sync(() => setState(saved)))
    })
    void settle(runtime, followStore, controller.signal).then((settled) => {
      if (!controller.signal.aborted && settled.status === "failure") {
        setState(settled)
      }
    })
    return () => controller.abort()
  }, [runtime])

  return state
}
