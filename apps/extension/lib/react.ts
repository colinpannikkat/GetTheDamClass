/**
 * The bridge between Effect and React.
 *
 * Effects describe work; React components need plain values to render. The
 * three hooks here run an effect and hand the component a small object with a
 * `status` field to switch on:
 *
 * - `useQuery`    load something when the component appears
 * - `useAction`   do something when the user asks (a click, a form submit)
 * - `useAccount`  who is signed in and what they are watching (or, signed
 *                 out, how far they got with signing in), kept up to date
 *
 * (React has its own, unrelated `useEffect`. In this file "an effect" always
 * means a value from the Effect library, and React's hook is `React.useEffect`.)
 */
import { Cause, Effect, Exit, Option, Stream } from "effect"
import * as React from "react"
import { AccountStore, type Saved } from "./AccountStore"
import { type StorageError, UnexpectedError } from "./domain"
import { type AppRuntime, type AppServices, runtime as liveRuntime } from "./runtime"

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** How a finished effect ended. `error` is one of the effect's typed errors. */
export type Settled<A, E> =
  | { readonly status: "success"; readonly value: A }
  | { readonly status: "failure"; readonly error: E | UnexpectedError }

export type QueryState<A, E> = { readonly status: "loading" } | Settled<A, E>

export type ActionState<A, E> = { readonly status: "idle" } | { readonly status: "loading" } | Settled<A, E>

export type AccountState =
  | { readonly status: "loading" }
  | Saved
  | { readonly status: "failure"; readonly error: StorageError | UnexpectedError }

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * The runtime the hooks use. It defaults to the real one, so the app needs no
 * provider. A test can swap in fake services:
 *
 *   <RuntimeContext value={ManagedRuntime.make(fakeLayer)}>...</RuntimeContext>
 */
export const RuntimeContext = React.createContext<AppRuntime>(liveRuntime)

/** Run an effect to the end and describe the result as a plain object. */
async function settle<A, E>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, E, AppServices>,
  signal?: AbortSignal
): Promise<Settled<A, E>> {
  // An `Exit` is Effect's record of how a run ended: a success, or a `Cause`
  // holding either one of our typed errors or an unexpected crash (a bug).
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Run an effect when the component mounts, and again whenever `deps` change
 * or `reload()` is called.
 *
 *   const { state, reload } = useQuery(() => listAlerts(), [])
 */
export function useQuery<A, E>(
  makeEffect: () => Effect.Effect<A, E, AppServices>,
  deps: ReadonlyArray<unknown>
): { readonly state: QueryState<A, E>; readonly reload: () => void } {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<QueryState<A, E>>({ status: "loading" })
  const [reloadCount, setReloadCount] = React.useState(0)

  React.useEffect(() => {
    // Aborting stops the effect (and its network request) when the component
    // goes away or a newer run starts, so an old result never overwrites a
    // new one.
    const controller = new AbortController()
    setState({ status: "loading" })
    void settle(runtime, makeEffect(), controller.signal).then((settled) => {
      if (!controller.signal.aborted) {
        setState(settled)
      }
    })
    return () => controller.abort()
    // `makeEffect` is left out on purpose: callers pass a new function on
    // every render, which would restart the query each time.
  }, [runtime, reloadCount, ...deps])

  const reload = React.useCallback(() => setReloadCount((count) => count + 1), [])
  return { state, reload }
}

/**
 * Get a `run` function that executes an effect on demand, plus the state of
 * the latest run. `run` also resolves with the result, for code that must act
 * on it straight away.
 *
 *   const { state, run } = useAction(subscribe)
 *   <Button loading={state.status === "loading"} onClick={() => run(classId)}>
 */
export function useAction<Args extends ReadonlyArray<unknown>, A, E>(
  action: (...args: Args) => Effect.Effect<A, E, AppServices>
): {
  readonly state: ActionState<A, E>
  readonly run: (...args: Args) => Promise<Settled<A, E>>
} {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<ActionState<A, E>>({ status: "idle" })

  // Unlike a query, an action is not aborted when the component goes away:
  // once the user has asked to subscribe, the request should finish.
  const run = React.useCallback(async (...args: Args) => {
    setState({ status: "loading" })
    const settled = await settle(runtime, action(...args))
    setState(settled)
    return settled
  }, [runtime, action])
  return { state, run }
}

/**
 * Everything the browser has saved (see `lib/AccountStore.ts`): who is signed
 * in and the classes they are watching, or, signed out, the email and code
 * request the sign-in form starts from. Updates by itself when any of it
 * changes, here or in another part of the extension.
 */
export function useAccount(): AccountState {
  const runtime = React.useContext(RuntimeContext)
  const [state, setState] = React.useState<AccountState>({ status: "loading" })

  React.useEffect(() => {
    const controller = new AbortController()
    const followStore = Effect.gen(function*() {
      const store = yield* AccountStore
      // Runs until aborted: `changes` never ends by itself.
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
