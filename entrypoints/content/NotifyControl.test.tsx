// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { AlreadySubscribed, type Credentials, type Crn, NetworkError, NotSubscribed, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { signIn, unsubscribe } from "@/lib/workflows"
import { NotifyControl, OtherTermNote } from "./NotifyControl"

const student: Credentials = { email: "student@oregonstate.edu", pin: "1234" }
const CRN: Crn = "33940"

/** One call the fake backend received. */
interface Call {
  readonly crn: Crn
  readonly credentials: Credentials
}

/**
 * Render the control with a fake backend. `subscribe` answers each press of
 * "Notify me" and `unsubscribe` each press of "Stop alerts"; the calls they
 * get are pushed onto the returned `calls` and `stopCalls`. Storage is WXT's
 * in-memory `browser`.
 *
 * The returned `run` executes a workflow against the same fake backend and
 * storage. Tests use it to do what the rest of the extension does while the
 * class page is open: sign in (the popup, or the framed sign-in page) or stop
 * an alert (the popup).
 */
async function renderControl(options: {
  readonly subscribe: Api["Service"]["subscribe"]
  readonly unsubscribe?: Api["Service"]["unsubscribe"]
}) {
  const calls: Array<Call> = []
  const stopCalls: Array<Call> = []
  const fakeApi = Layer.mock(Api, {
    signIn: () => Effect.void,
    unsubscribe: (crn, credentials) => {
      stopCalls.push({ crn, credentials })
      return options.unsubscribe?.(crn, credentials) ?? Effect.void
    },
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
  await screen.findAllByRole("button")
  return { calls, stopCalls, run: runtime.runPromise, unmount: view.unmount }
}

/** As if the student signed in earlier and already watches these classes. */
const signedIn = (watching: ReadonlyArray<Crn> = []) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(student)
      yield* store.watch(student.email, watching)
    }).pipe(Effect.provide(AccountStore.layer))
  )
const notifyButton = () => screen.getByRole("button", { name: "Notify me" })
const stopButton = () => screen.getByRole("button", { name: "Stop alerts" })
const signInFrame = () => screen.getByTitle("Sign in") as HTMLIFrameElement
const WATCHING_LINE = "We'll email you when a seat opens or the class fills up."

/** Wait a moment, before checking that something did NOT happen. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

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
      source: ("source" in from ? from.source : signInFrame().contentWindow) as MessageEventSource
    })
  )
}

/** What the framed sign-in page posts once the email and PIN are accepted and saved. */
const SIGNED_IN = { type: "getthedamclass/signed-in" }

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
    const note = screen.getByText(WATCHING_LINE)
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
    // It can be stopped right here.
    expect(stopButton()).toBeDefined()
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
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()

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

  it("says nothing about an earlier press once the popup has changed things since", async () => {
    await signedIn([CRN])
    let online = false
    const { run } = await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: () => (online ? Effect.void : Effect.fail(new NetworkError({ cause: "offline" })))
    })

    // "Stop alerts" fails here...
    fireEvent.click(stopButton())
    await screen.findByText(/Couldn't reach the server/)
    // ...and works in the popup a little later.
    online = true
    await run(unsubscribe(CRN))
    fireEvent.click(await screen.findByRole("button", { name: "Notify me" }))

    // Watching again: the old failure is not shown next to it.
    await screen.findByText(WATCHING_LINE)
    expect(screen.queryByRole("alert")?.textContent).toBe("")

    // Stopped here, started here again, then stopped in the popup: the
    // "Alerts stopped" of the earlier press here does not come back.
    fireEvent.click(stopButton())
    await screen.findByText("Alerts stopped for this class.")
    fireEvent.click(notifyButton())
    await screen.findByText(WATCHING_LINE)
    await run(unsubscribe(CRN))
    await screen.findByRole("button", { name: "Notify me" })
    expect(screen.queryByRole("status")?.textContent).toBe("")
  })

  it("goes back to Notify me when the user signs out", async () => {
    await signedIn([CRN])
    await renderControl({ subscribe: () => Effect.void })
    await screen.findByRole("button", { name: "Watching" })

    await fakeBrowser.storage.local.clear()

    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
  })
})

describe("NotifyControl, stopping alerts", () => {
  it("offers no way to stop what is not being watched", async () => {
    await signedIn(["53476"])
    await renderControl({ subscribe: () => Effect.void })
    expect(notifyButton()).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()
  })

  it("stops the alert, goes back to Notify me, says so, and keeps the keyboard", async () => {
    await signedIn([CRN])
    const { calls, stopCalls } = await renderControl({ subscribe: () => Effect.void })
    // A real button, so Tab reaches it and Enter or Space presses it.
    expect(stopButton().tagName).toBe("BUTTON")
    expect(stopButton().hasAttribute("disabled")).toBe(false)

    stopButton().focus()
    fireEvent.click(stopButton())

    const button = await screen.findByRole("button", { name: "Notify me" })
    expect(stopCalls).toEqual([{ crn: CRN, credentials: student }])
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()
    // Announced politely; and focus did not vanish with the button that had it.
    expect(screen.getByText("Alerts stopped for this class.").closest("[role=status]")).not.toBeNull()
    expect(document.activeElement).toBe(button)

    // And it can be started again, which replaces the line.
    fireEvent.click(button)
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByText("Alerts stopped for this class.")).toBeNull()
    expect(screen.getByText(WATCHING_LINE)).toBeDefined()
    expect(calls).toHaveLength(1)
  })

  it("puts a stale Watching right: the alert was already stopped somewhere else", async () => {
    // Stopped with the link in an email, or in another browser. This browser
    // still has it saved, so the page says "Watching".
    await signedIn([CRN])
    await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: (crn) => Effect.fail(new NotSubscribed({ crn }))
    })

    fireEvent.click(stopButton())

    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
    expect(screen.queryByRole("alert")?.textContent).toBe("")
  })

  it("is busy while the request is on its way, and ignores more presses", async () => {
    await signedIn([CRN])
    const { stopCalls } = await renderControl({ subscribe: () => Effect.void, unsubscribe: () => Effect.never })

    fireEvent.click(stopButton())
    await expect.poll(() => stopButton().getAttribute("aria-busy")).toBe("true")
    fireEvent.click(stopButton())

    expect(stopCalls).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Watching" })).toBeDefined()
  })

  it("stays Watching and says why when stopping fails, and can be tried again", async () => {
    await signedIn([CRN])
    let attempts = 0
    await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: () => (++attempts === 1 ? Effect.fail(new NetworkError({ cause: "offline" })) : Effect.void)
    })

    fireEvent.click(stopButton())
    const problem = await screen.findByText(/Couldn't reach the server/)
    expect(problem.closest("[role=alert]")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Watching" })).toBeDefined()

    fireEvent.click(stopButton())
    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull()
  })

  it("does not open the sign-in popover when the saved PIN is rejected; it says what to do", async () => {
    await signedIn([CRN])
    await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: () => Effect.fail(new WrongPin({ message: "User authentication failed" }))
    })

    fireEvent.click(stopButton())

    expect(await screen.findByText(/Your saved PIN no longer works\. Sign out, then sign in again\./)).toBeDefined()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("NotifyControl, sign-in popover", () => {
  it("asks a signed-out user to sign in, in a frame showing the extension's own page", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    const popover = await openPopover()
    expect(popover.textContent).toContain("Sign in to get an email when a seat opens or the class fills up.")
    expect(signInFrame().src).toBe(fakeBrowser.runtime.getURL("/signin.html"))
    // The email and PIN are typed in that frame. The control itself, which is
    // drawn inside the university's page, has no field to type them into.
    expect(document.querySelectorAll("input")).toHaveLength(0)
    expect(calls).toEqual([]) // Signed out: nothing was sent.
  })

  it("subscribes without a second press once the user has signed in in its frame", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    // What the framed page does on "Continue": sign in, save, then say so.
    await run(signIn(student))
    postToPage(SIGNED_IN)

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
    postToPage(SIGNED_IN)

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.credentials.pin)).toEqual(["0000", "1234"])
  })

  it("continues when the email and PIN typed are the ones already saved", async () => {
    // The server refused the saved sign-in once (a hiccup on its side) and
    // accepts the very same email and PIN a moment later.
    await signedIn()
    let attempts = 0
    const { calls } = await renderControl({
      subscribe: () => (++attempts === 1 ? Effect.fail(new WrongPin({ message: "User authentication failed" })) : Effect.void)
    })
    await openPopover()

    // The frame saves what is already saved, which changes nothing: Chrome
    // reports no storage change for that. All this control gets is the message.
    postToPage(SIGNED_IN)

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls).toEqual([{ crn: CRN, credentials: student }, { crn: CRN, credentials: student }])
  })

  it("does not subscribe when the user signs in somewhere else while the popover is open", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    // In the toolbar popup, or on another tab: nobody used this form.
    await run(signIn(student))
    await settled()

    expect(calls).toEqual([])
    expect(notifyButton()).toBeDefined()
  })

  it("drops the request when the control is gone before the sign-in finishes", async () => {
    // The content script removes the control as soon as its panel shows
    // another section (see index.test.tsx). A sign-in that finishes after
    // that must not subscribe to anything.
    const { calls, run, unmount } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const frame = signInFrame().contentWindow

    unmount()
    await run(signIn(student))
    postToPage(SIGNED_IN, { source: frame })
    await settled()

    expect(calls).toEqual([])
  })

  it("does not subscribe by itself when the user signs in after closing the popover", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const frame = signInFrame().contentWindow
    fireEvent.click(notifyButton()) // closes it

    await run(signIn(student))
    postToPage(SIGNED_IN, { source: frame })
    await settled()

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
    const { calls } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const heightBefore = signInFrame().style.height

    // The university's page (or a frame in it) posting our messages.
    postToPage({ type: "getthedamclass/close" }, { source: window })
    postToPage({ type: "getthedamclass/close" }, { origin: "https://classes.oregonstate.edu" })
    postToPage({ type: "getthedamclass/resize", height: 9999 }, { origin: "https://classes.oregonstate.edu" })
    postToPage(SIGNED_IN, { source: window })
    postToPage(SIGNED_IN, { origin: "https://classes.oregonstate.edu" })
    // Our frame posting something we do not know.
    postToPage({ type: "getthedamclass/resize", height: "tall" })
    postToPage("close")

    await settled()
    expect(screen.getByRole("dialog")).toBeDefined()
    expect(signInFrame().style.height).toBe(heightBefore)
    expect(calls).toEqual([])
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
