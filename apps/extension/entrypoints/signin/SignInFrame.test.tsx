// @vitest-environment happy-dom
import { InvalidCode } from "@getthedamclass/shared/domain"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { RuntimeContext } from "@/lib/react"
import { SignInFrame } from "./SignInFrame"

const email = "student@oregonstate.edu"
const token = "student-token"

/** Everything the frame posted to the page around it: `[message, targetOrigin]`. */
let posted: Array<[unknown, string]>

/** Render the framed page with a fake server, and wait for its form. */
async function renderFrame(fakeApi: Layer.PartialEffectful<Api["Service"]> = {}) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))
  render(
    <RuntimeContext value={runtime}>
      <SignInFrame />
    </RuntimeContext>
  )
  await screen.findByRole("textbox")
}

const emailField = () => screen.getByLabelText("Email") as HTMLInputElement
const codeField = () => screen.getByLabelText("6-digit code") as HTMLInputElement

/** Both steps: ask for a code for `email`, then type `code`. */
async function signInWith(code: string) {
  fireEvent.change(emailField(), { target: { value: email } })
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }))
  fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: code } })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

beforeEach(() => {
  fakeBrowser.reset()
  posted = []
  // In the test there is no page around the frame: `window.parent` is the
  // window itself, so this catches what the class page would receive.
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown, targetOrigin: unknown) => {
    posted.push([message, String(targetOrigin)])
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("SignInFrame", () => {
  /** The messages posted so far, without the ones about the frame's height. */
  const postedEvents = () => posted.filter(([message]) => (message as { type: string }).type !== "getthedamclass/resize")
  const SIGNED_IN = [{ type: "getthedamclass/signed-in" }, "https://classes.oregonstate.edu"]
  const CLOSE = [{ type: "getthedamclass/close" }, "https://classes.oregonstate.edu"]

  it("signs in, saves the token, and then tells the class page that it did (and nothing more)", async () => {
    await renderFrame({ sendCode: () => Effect.void, signIn: () => Effect.succeed(token) })
    expect(document.activeElement).toBe(emailField())

    await signInWith("012345")

    await expect.poll(postedEvents).toEqual([SIGNED_IN])
    // Saved before the page was told: it reads the saved sign-in straight away.
    expect(await fakeBrowser.storage.local.get()).toEqual({ email, token })
    expect(JSON.stringify(posted)).not.toContain("student")
    expect(JSON.stringify(posted)).not.toContain("012345")
    expect(JSON.stringify(posted)).not.toContain(token)
  })

  it("tells the class page that it signed in, not to close, when the sign-in shows up in storage before it is done", async () => {
    // Storage is saved before the form hears back from the workflow, and the
    // frame can see the change first. Here it is in storage even before the
    // workflow saves it, which then changes nothing in storage (see
    // vitest.setup.ts).
    await renderFrame({
      sendCode: () => Effect.void,
      signIn: () =>
        Effect.promise(() => fakeBrowser.storage.local.set({ email, token })).pipe(
          Effect.andThen(Effect.sleep("50 millis")),
          Effect.as(token)
        )
    })

    await signInWith("012345")

    await expect.poll(postedEvents).toEqual([SIGNED_IN])
  })

  it("asks to be closed when someone signs in somewhere else, and does not say it signed in", async () => {
    await renderFrame()

    // The toolbar popup, or the frame on another tab.
    await fakeBrowser.storage.local.set({ email, token })

    await expect.poll(postedEvents).toEqual([CLOSE])
  })

  it("asks to be closed when someone signs in somewhere else after a code was refused here", async () => {
    await renderFrame({
      sendCode: () => Effect.void,
      signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." }))
    })
    await signInWith("987654")
    await screen.findByText("That code isn't right.")

    await fakeBrowser.storage.local.set({ email, token })

    await expect.poll(postedEvents).toEqual([CLOSE])
  })

  it("tells the class page nothing when the code is refused", async () => {
    await renderFrame({
      sendCode: () => Effect.void,
      signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." }))
    })

    await signInWith("987654")
    await screen.findByText("That code isn't right.")

    expect(postedEvents()).toEqual([])
  })

  it("never tells the class page what was typed", async () => {
    await renderFrame({
      sendCode: () => Effect.void,
      signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." }))
    })

    await signInWith("987654")
    await screen.findByText("That code isn't right.")
    fireEvent.keyDown(codeField(), { key: "Escape" })

    expect(posted.length).toBeGreaterThan(0)
    expect(JSON.stringify(posted)).not.toContain("987654")
    expect(JSON.stringify(posted)).not.toContain("student")
  })

  it("fills in the email last used here, after the server stopped accepting the sign-in", async () => {
    // What `forgetToken` leaves behind.
    await fakeBrowser.storage.local.set({ email })
    await renderFrame()

    expect(emailField().value).toBe(email)
    expect(document.activeElement).toBe(emailField())
  })

  it("starts at the code step when a code was asked for in the popup, and the keyboard in its field", async () => {
    await fakeBrowser.storage.local.set({ codeRequest: { email, sentAt: Date.now() } })
    await renderFrame()

    expect(codeField()).toBeDefined()
    expect(document.activeElement).toBe(codeField())
  })

  it("passes Escape on to the class page, and only to the class page", async () => {
    await renderFrame()
    posted = []

    fireEvent.keyDown(emailField(), { key: "Escape" })
    fireEvent.keyDown(emailField(), { key: "a" })

    expect(posted).toEqual([[{ type: "getthedamclass/close" }, "https://classes.oregonstate.edu"]])
  })

  it("reports its height so the frame can be made to fit", async () => {
    // The test DOM never calls a ResizeObserver; call it the way a browser does.
    let resized: (() => void) | undefined
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe() {}
        disconnect() {}
      }
    )
    await renderFrame()
    // The form is on screen one step before React runs the effect that creates
    // the observer, so wait for that too.
    await vi.waitFor(() => expect(resized).toBeDefined())

    resized?.()

    expect(posted.at(-1)).toEqual([
      { type: "getthedamclass/resize", height: expect.any(Number) },
      "https://classes.oregonstate.edu"
    ])
    vi.unstubAllGlobals()
  })
})
