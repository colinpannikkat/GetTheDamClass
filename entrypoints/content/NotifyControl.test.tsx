// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { AlreadySubscribed, type Credentials, type Crn, NetworkError, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { signIn, unsubscribe } from "@/lib/workflows"
import { NotifyControl, OtherTermNote } from "./NotifyControl"

const student: Credentials = { email: "student@oregonstate.edu", pin: "1234" }
const CRN: Crn = "33940"

/** One call the fake backend received. */
interface SubscribeCall {
  readonly crn: Crn
  readonly credentials: Credentials
}

/**
 * Render the control with a fake backend. `subscribe` answers each press;
 * every call it gets is pushed onto the returned `calls`. Storage is WXT's
 * in-memory `browser`.
 *
 * The returned `run` executes a workflow against the same fake backend and
 * storage. Tests use it to do what the rest of the extension does while the
 * class page is open: sign in (the framed sign-in page) or stop an alert (the
 * popup).
 */
async function renderControl(options: { readonly subscribe: Api["Service"]["subscribe"] }) {
  const calls: Array<SubscribeCall> = []
  const fakeApi = Layer.mock(Api, {
    signIn: () => Effect.void,
    unsubscribe: () => Effect.void,
    subscribe: (crn, credentials) => {
      calls.push({ crn, credentials })
      return options.subscribe(crn, credentials)
    }
  })
  const runtime = ManagedRuntime.make(Layer.mergeAll(fakeApi, AccountStore.layer))
  const view = render(
    <RuntimeContext value={runtime}>
      <NotifyControl crn={CRN} />
    </RuntimeContext>
  )
  // The button appears once the control has read the saved account.
  await screen.findByRole("button")
  return { calls, run: runtime.runPromise, unmount: view.unmount }
}

const signedIn = (watching: ReadonlyArray<Crn> = []) => fakeBrowser.storage.local.set({ ...student, watching })
const notifyButton = () => screen.getByRole("button", { name: "Notify me" })
const signInFrame = () => screen.getByTitle("Sign in") as HTMLIFrameElement

/** Press the button and wait for the sign-in popover to be open and listening. */
async function openPopover() {
  fireEvent.click(notifyButton())
  const popover = await screen.findByRole("dialog", { name: "Sign in to get alerts" })
  await act(async () => {}) // lets React finish attaching the popover's listeners
  return popover
}

/** A message as the framed sign-in page would post it, unless `from` says otherwise. */
function postToPage(data: unknown, from: { readonly origin?: string; readonly source?: unknown } = {}) {
  fireEvent(
    window,
    new MessageEvent("message", {
      data,
      origin: from.origin ?? new URL(fakeBrowser.runtime.getURL("/signin.html")).origin,
      source: (from.source ?? signInFrame().contentWindow) as MessageEventSource
    })
  )
}

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("NotifyControl, signed in", () => {
  it("does not touch the backend until the button is pressed", async () => {
    await signedIn()
    const { calls } = await renderControl({ subscribe: () => Effect.void })
    expect(notifyButton()).toBeDefined()
    expect(calls).toEqual([])
  })

  it("subscribes and settles into a calm Watching state", async () => {
    await signedIn()
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    fireEvent.click(notifyButton())

    const watching = await screen.findByRole("button", { name: "Watching" })
    expect(calls).toEqual([{ crn: CRN, credentials: student }])
    // The confirmation is announced politely, not as an alert.
    const note = screen.getByText("We'll email you when a seat opens.")
    expect(note.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByRole("alert")?.textContent).toBe("")

    // "Watching" can still be focused but pressing it does nothing more.
    expect(watching.getAttribute("aria-disabled")).toBe("true")
    expect(watching.hasAttribute("disabled")).toBe(false)
    fireEvent.click(watching)
    expect(calls).toHaveLength(1)
  })

  it("stays focusable and ignores presses while the request is on its way", async () => {
    await signedIn()
    let finish = () => {}
    const serverReplied = new Promise<void>((resolve) => (finish = resolve))
    const { calls } = await renderControl({ subscribe: () => Effect.promise(() => serverReplied) })

    notifyButton().focus()
    fireEvent.click(notifyButton())
    await expect.poll(() => notifyButton().getAttribute("aria-busy")).toBe("true")
    expect(notifyButton().hasAttribute("disabled")).toBe(false)
    expect(document.activeElement).toBe(notifyButton())
    fireEvent.click(notifyButton())
    expect(calls).toHaveLength(1)

    finish()
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
  })

  it("treats 'already subscribed' as the same Watching state, not as an error", async () => {
    await signedIn()
    await renderControl({ subscribe: (crn) => Effect.fail(new AlreadySubscribed({ crn })) })

    fireEvent.click(notifyButton())

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByRole("alert")?.textContent).toBe("")
  })

  it("shows other failures inline and lets the user try again", async () => {
    await signedIn()
    let attempts = 0
    const { calls } = await renderControl({
      subscribe: () => (++attempts === 1 ? Effect.fail(new NetworkError({ cause: "offline" })) : Effect.void)
    })

    fireEvent.click(notifyButton())
    const problem = await screen.findByText(/Couldn't reach the server/)
    expect(problem.closest("[role=alert]")).not.toBeNull()
    expect(notifyButton().getAttribute("aria-disabled")).toBeNull()

    fireEvent.click(notifyButton())
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull()
    expect(calls).toHaveLength(2)
  })
})

describe("NotifyControl, in step with the rest of the extension", () => {
  it("shows Watching straight away for a class the user already watches, without a request", async () => {
    await signedIn([CRN])
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    // No "We'll email you" line: nothing was just set up.
    expect(screen.queryByText(/We'll email you/)).toBeNull()
    expect(calls).toEqual([])
  })

  it("shows Notify me for a class the user does not watch, whatever else they watch", async () => {
    await signedIn(["53476"])
    await renderControl({ subscribe: () => Effect.void })
    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
  })

  it("goes back to Notify me when the alert is stopped in the popup, and can subscribe again", async () => {
    await signedIn()
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    fireEvent.click(notifyButton())
    await screen.findByRole("button", { name: "Watching" })

    // What "Stop" in the popup runs. The control is not touched or redrawn.
    await run(unsubscribe(CRN))

    const button = await screen.findByRole("button", { name: "Notify me" })
    expect(button.getAttribute("aria-disabled")).toBeNull()
    expect(screen.queryByText(/We'll email you/)).toBeNull()

    fireEvent.click(button)
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.crn)).toEqual([CRN, CRN])
  })

  it("goes back to Notify me when another account signs in, and subscribes for that account", async () => {
    await signedIn()
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    fireEvent.click(notifyButton())
    await screen.findByRole("button", { name: "Watching" })

    const other: Credentials = { email: "other@oregonstate.edu", pin: "4321" }
    await run(signIn(other))

    fireEvent.click(await screen.findByRole("button", { name: "Notify me" }))
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.credentials)).toEqual([student, other])
  })

  it("goes back to Notify me when the user signs out", async () => {
    await signedIn([CRN])
    await renderControl({ subscribe: () => Effect.void })
    await screen.findByRole("button", { name: "Watching" })

    await fakeBrowser.storage.local.remove(["email", "pin", "watching"])

    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
  })
})

describe("NotifyControl, sign-in popover", () => {
  it("asks a signed-out user to sign in, in a frame showing the extension's own page", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    const popover = await openPopover()
    expect(popover.textContent).toContain("Sign in to get an email when a seat opens in this class.")
    expect(signInFrame().src).toBe(fakeBrowser.runtime.getURL("/signin.html"))
    // The email and PIN are typed in that frame. The control itself, which is
    // drawn inside the university's page, has no field to type them into.
    expect(document.querySelectorAll("input")).toHaveLength(0)
    expect(calls).toEqual([]) // Signed out: nothing was sent.
  })

  it("subscribes without a second press once the user has signed in", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    await run(signIn(student)) // what the framed page does on "Continue"

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(calls).toEqual([{ crn: CRN, credentials: student }])
    await expect.poll(() => document.activeElement).toBe(screen.getByRole("button", { name: "Watching" }))
  })

  it("asks again when the saved sign-in is rejected, and continues with the new one", async () => {
    await fakeBrowser.storage.local.set({ email: student.email, pin: "0000" })
    const { calls, run } = await renderControl({
      subscribe: (_crn, credentials) =>
        credentials.pin === "0000" ? Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })) : Effect.void
    })

    const popover = await openPopover()
    expect(popover.textContent).toContain("Your saved PIN no longer works.")
    // It is not shown as an error next to the button as well.
    expect(screen.queryByText(/PIN doesn't match/)).toBeNull()

    await run(signIn(student))

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.credentials.pin)).toEqual(["0000", "1234"])
  })

  it("drops the request when the control is gone before the sign-in finishes", async () => {
    // The content script removes the control as soon as its panel shows
    // another section (see index.test.tsx). A sign-in that finishes after
    // that must not subscribe to anything.
    const { calls, run, unmount } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    unmount()
    await run(signIn(student))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(calls).toEqual([])
  })

  it("does not subscribe by itself when the user signs in after closing the popover", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    fireEvent.click(notifyButton()) // closes it

    await run(signIn(student))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(calls).toEqual([])
    expect(notifyButton()).toBeDefined()
  })

  it("closes when Escape is pressed in the frame, and gives focus back to the button", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    postToPage({ type: "getthedamclass/close" })

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(notifyButton())
    // Closing is not a failure: no error message, and the button works again.
    expect(screen.queryByRole("alert")?.textContent).toBe("")
    expect(calls).toEqual([])

    fireEvent.click(notifyButton())
    expect(await screen.findByRole("dialog")).toBeDefined()
  })

  it("makes the frame as tall as the form says it is", async () => {
    await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    postToPage({ type: "getthedamclass/resize", height: 268 })

    expect(signInFrame().style.height).toBe("268px")
  })

  it("ignores messages that are not from its own frame or not from the extension", async () => {
    await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const heightBefore = signInFrame().style.height

    // The university's page (or a frame in it) posting our messages.
    postToPage({ type: "getthedamclass/close" }, { source: window })
    postToPage({ type: "getthedamclass/close" }, { origin: "https://classes.oregonstate.edu" })
    postToPage({ type: "getthedamclass/resize", height: 9999 }, { origin: "https://classes.oregonstate.edu" })
    // Our frame posting something we do not know.
    postToPage({ type: "getthedamclass/resize", height: "tall" })
    postToPage("close")

    expect(screen.getByRole("dialog")).toBeDefined()
    expect(signInFrame().style.height).toBe(heightBefore)
  })

  it("closes on Escape pressed on the button", async () => {
    await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    fireEvent.keyDown(notifyButton(), { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes on a press outside, but not on a press inside", async () => {
    await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    fireEvent.pointerDown(screen.getByRole("dialog"))
    expect(screen.getByRole("dialog")).toBeDefined()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes when the button is pressed again", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    await openPopover()
    expect(notifyButton().getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(notifyButton())
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(calls).toEqual([])
  })
})

describe("OtherTermNote", () => {
  it("says which term the alerts cover", () => {
    render(<OtherTermNote />)
    expect(screen.getByText(/^Seat alerts cover .+ classes only\.$/)).toBeDefined()
  })
})
