// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "./Api"
import { AccountStore } from "./AccountStore"
import { WrongPin } from "./domain"
import { RuntimeContext, useAccount, useAction, useQuery } from "./react"

// Each hook is used by a tiny component that prints its state as text.

/** Render with a runtime whose Api is fake. Storage is WXT's in-memory `browser`. */
function renderWithFakeApi(ui: ReactNode, fakeApi: Layer.PartialEffectful<Api["Service"]> = {}) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))
  return render(<RuntimeContext value={runtime}>{ui}</RuntimeContext>)
}

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("useQuery", () => {
  function Query({ effect }: { readonly effect: Effect.Effect<string, WrongPin> }) {
    const { state, reload } = useQuery(() => effect, [])
    return (
      <div>
        <p>
          {state.status === "loading" && "loading"}
          {state.status === "success" && `success: ${state.value}`}
          {state.status === "failure" && `failure: ${state.error._tag}`}
        </p>
        <button onClick={reload}>reload</button>
      </div>
    )
  }

  it("is loading, then shows the value", async () => {
    renderWithFakeApi(<Query effect={Effect.succeed("hello")} />)
    expect(screen.getByText("loading")).toBeDefined()
    expect(await screen.findByText("success: hello")).toBeDefined()
  })

  it("shows a typed error", async () => {
    renderWithFakeApi(<Query effect={Effect.fail(new WrongPin({ message: "no" }))} />)
    expect(await screen.findByText("failure: WrongPin")).toBeDefined()
  })

  it("turns a crash (a bug) into UnexpectedError instead of throwing", async () => {
    renderWithFakeApi(<Query effect={Effect.die(new Error("boom"))} />)
    expect(await screen.findByText("failure: UnexpectedError")).toBeDefined()
  })

  it("runs again on reload", async () => {
    let runs = 0
    renderWithFakeApi(<Query effect={Effect.sync(() => `run ${++runs}`)} />)
    // (React's StrictMode is off here, so the first run is run 1.)
    expect(await screen.findByText("success: run 1")).toBeDefined()
    fireEvent.click(screen.getByText("reload"))
    expect(await screen.findByText("success: run 2")).toBeDefined()
  })
})

describe("useAction", () => {
  const greet = (name: string) =>
    name === "" ? Effect.fail(new WrongPin({ message: "no" })) : Effect.succeed(`hello ${name}`)

  function Action({ onDone }: { readonly onDone?: (status: string) => void }) {
    const { state, run } = useAction(greet)
    return (
      <div>
        <p>
          {state.status === "idle" && "idle"}
          {state.status === "loading" && "loading"}
          {state.status === "success" && `success: ${state.value}`}
          {state.status === "failure" && `failure: ${state.error._tag}`}
        </p>
        <button onClick={() => run("Ada").then((result) => onDone?.(result.status))}>greet Ada</button>
        <button onClick={() => run("")}>greet nobody</button>
      </div>
    )
  }

  it("does nothing until run is called, then shows the result", async () => {
    renderWithFakeApi(<Action />)
    expect(screen.getByText("idle")).toBeDefined()
    fireEvent.click(screen.getByText("greet Ada"))
    expect(await screen.findByText("success: hello Ada")).toBeDefined()
  })

  it("shows a typed error", async () => {
    renderWithFakeApi(<Action />)
    fireEvent.click(screen.getByText("greet nobody"))
    expect(await screen.findByText("failure: WrongPin")).toBeDefined()
  })

  it("run resolves with the result", async () => {
    const statuses: Array<string> = []
    renderWithFakeApi(<Action onDone={(status) => statuses.push(status)} />)
    fireEvent.click(screen.getByText("greet Ada"))
    await screen.findByText("success: hello Ada")
    expect(statuses).toEqual(["success"])
  })
})

describe("useAccount", () => {
  function Who() {
    const account = useAccount()
    return (
      <p>
        {account.status === "signedIn"
          ? `signedIn: ${account.credentials.email}, watching: ${account.watching.join(" ")}`
          : account.status}
      </p>
    )
  }

  it("follows the saved account as it changes", async () => {
    renderWithFakeApi(<Who />)
    expect(await screen.findByText("signedOut")).toBeDefined()

    // As if the user signed in somewhere else in the extension...
    await fakeBrowser.storage.local.set({ email: "student@oregonstate.edu", pin: "1234" })
    expect(await screen.findByText("signedIn: student@oregonstate.edu, watching:")).toBeDefined()

    // ...asked for alerts for a class there...
    await fakeBrowser.storage.local.set({ watching: ["33940"] })
    expect(await screen.findByText("signedIn: student@oregonstate.edu, watching: 33940")).toBeDefined()

    // ...and signed out.
    await fakeBrowser.storage.local.remove(["email", "pin", "watching"])
    expect(await screen.findByText("signedOut")).toBeDefined()
  })

  it("stops listening when the component goes away", async () => {
    const { unmount } = renderWithFakeApi(<Who />)
    await screen.findByText("signedOut")
    expect(fakeBrowser.storage.local.onChanged.hasListeners()).toBe(true)
    unmount()
    await expect.poll(() => fakeBrowser.storage.local.onChanged.hasListeners()).toBe(false)
  })
})
