// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { type Credentials, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { SignInFrame } from "./SignInFrame"

const student: Credentials = { email: "student@oregonstate.edu", pin: "1234" }

/** Everything the frame posted to the page around it: `[message, targetOrigin]`. */
let posted: Array<[unknown, string]>

/** Render the framed page with a fake backend, and wait for its form. */
async function renderFrame(signIn: Api["Service"]["signIn"] = () => Effect.void) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, { signIn }), AccountStore.layer))
  render(
    <RuntimeContext value={runtime}>
      <SignInFrame />
    </RuntimeContext>
  )
  await screen.findByLabelText("Email")
}

const email = () => screen.getByLabelText("Email") as HTMLInputElement
const pin = () => screen.getByLabelText("4-digit PIN") as HTMLInputElement

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

  it("signs in, saves the account, and then tells the class page that it did (and nothing more)", async () => {
    const sent: Array<Credentials> = []
    await renderFrame((credentials) => Effect.sync(() => void sent.push(credentials)))
    expect(document.activeElement).toBe(email())

    fireEvent.change(email(), { target: { value: student.email } })
    fireEvent.change(pin(), { target: { value: student.pin } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    await expect.poll(postedEvents).toEqual([SIGNED_IN])
    // Saved before the page was told: it reads the saved sign-in straight away.
    expect(await fakeBrowser.storage.local.get()).toEqual(student)
    expect(sent).toEqual([student])
    expect(JSON.stringify(posted)).not.toContain("student")
    expect(JSON.stringify(posted)).not.toContain(student.pin)
  })

  it("tells the class page also when the email and PIN are the ones already saved", async () => {
    // Saving them again changes nothing in storage, so the page would never
    // hear of this sign-in through storage (see vitest.setup.ts).
    await fakeBrowser.storage.local.set(student)
    await renderFrame()

    fireEvent.change(pin(), { target: { value: student.pin } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    await expect.poll(postedEvents).toEqual([SIGNED_IN])
  })

  it("tells the class page nothing when the sign-in is refused", async () => {
    await renderFrame(() => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })))

    fireEvent.change(email(), { target: { value: student.email } })
    fireEvent.change(pin(), { target: { value: "9876" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await screen.findByText(/PIN doesn't match/)

    expect(postedEvents()).toEqual([])
  })

  it("never tells the class page what was typed", async () => {
    await renderFrame(() => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })))

    fireEvent.change(email(), { target: { value: student.email } })
    fireEvent.change(pin(), { target: { value: "9876" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await screen.findByText(/PIN doesn't match/)
    fireEvent.keyDown(pin(), { key: "Escape" })

    expect(posted.length).toBeGreaterThan(0)
    expect(JSON.stringify(posted)).not.toContain("9876")
    expect(JSON.stringify(posted)).not.toContain("student")
  })

  it("fills in the saved email when the saved PIN stopped working, and starts in the PIN field", async () => {
    await fakeBrowser.storage.local.set({ email: student.email, pin: "0000" })
    await renderFrame()

    expect(email().value).toBe(student.email)
    expect(pin().value).toBe("")
    expect(document.activeElement).toBe(pin())
  })

  it("passes Escape on to the class page, and only to the class page", async () => {
    await renderFrame()
    posted = []

    fireEvent.keyDown(email(), { key: "Escape" })
    fireEvent.keyDown(email(), { key: "a" })

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
