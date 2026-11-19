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
  it("signs in and saves the account, which is how the class page finds out", async () => {
    const sent: Array<Credentials> = []
    await renderFrame((credentials) => Effect.sync(() => void sent.push(credentials)))
    expect(document.activeElement).toBe(email())

    fireEvent.change(email(), { target: { value: student.email } })
    fireEvent.change(pin(), { target: { value: student.pin } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    await expect.poll(() => fakeBrowser.storage.local.get()).toEqual({ ...student, watching: [] })
    expect(sent).toEqual([student])
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
    let resized: () => void = () => {}
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

    resized()

    expect(posted.at(-1)).toEqual([
      { type: "getthedamclass/resize", height: expect.any(Number) },
      "https://classes.oregonstate.edu"
    ])
    vi.unstubAllGlobals()
  })
})
