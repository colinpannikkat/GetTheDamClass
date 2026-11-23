// @vitest-environment happy-dom
import {
  AddDeadlinePassed,
  AlreadySubscribed,
  NotSignedIn,
  NotSubscribed,
  TermNotOpen
} from "@getthedamclass/shared/domain"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { type ClassId, NetworkError } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { signIn, unsubscribe } from "@/lib/workflows"
import { NotifyControl } from "./NotifyControl"

const email = "student@oregonstate.edu"
const token = "student-token"
const INTRO: ClassId = { term: "202702", crn: "33940" }
const INTRO_IN_FALL: ClassId = { term: "202701", crn: "33940" }

interface Call {
  readonly classId: ClassId
  readonly token: string
}

const notSignedIn = new NotSignedIn({ message: "You're not signed in. Sign in with your email to continue." })

async function renderControl(options: {
  readonly subscribe: (
    token: string,
    classId: ClassId
  ) => Effect.Effect<void, Effect.Error<ReturnType<Api["Service"]["subscribe"]>>>
  readonly unsubscribe?: Api["Service"]["unsubscribe"]
  readonly signIn?: string
}) {
  const calls: Array<Call> = []
  const stopCalls: Array<Call> = []
  const fakeApi = Layer.mock(Api, {
    signIn: () => Effect.succeed(options.signIn ?? token),
    unsubscribe: (token, classId) => {
      stopCalls.push({ classId, token })
      return options.unsubscribe?.(token, classId) ?? Effect.void
    },
    subscribe: (token, classId) => {
      calls.push({ classId, token })
      return Effect.as(options.subscribe(token, classId), { ...classId, title: "INTRO TO COMPUTER SCIENCE I" })
    }
  })
  const runtime = ManagedRuntime.make(Layer.mergeAll(fakeApi, AccountStore.layer))
  const view = render(
    <RuntimeContext value={runtime}>
      <NotifyControl classId={INTRO} />
    </RuntimeContext>
  )
  await screen.findAllByRole("button")
  return { calls, stopCalls, run: runtime.runPromise, unmount: view.unmount }
}

const signedIn = (watching: ReadonlyArray<ClassId> = []) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const store = yield* AccountStore
      yield* store.save(email, token)
      yield* store.watch(email, watching)
    }).pipe(Effect.provide(AccountStore.layer))
  )
const notifyButton = () => screen.getByRole("button", { name: "Notify me" })
const stopButton = () => screen.getByRole("button", { name: "Stop alerts" })
const signInFrame = () => screen.getByTitle("Sign in") as HTMLIFrameElement
const WATCHING_LINE = "We'll email you when a seat opens or the class fills up."

const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

async function openPopover() {
  fireEvent.click(notifyButton())
  const popover = await screen.findByRole("dialog", { name: "Sign in to get alerts" })
  await act(async () => {})
  return popover
}

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

const SIGNED_IN = { type: "getthedamclass/signed-in" }

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("NotifyControl, signed in", () => {
  it("does not touch the server until the button is pressed", async () => {
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
    expect(calls).toEqual([{ classId: INTRO, token }])
    const note = screen.getByText(WATCHING_LINE)
    expect(note.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByRole("alert")?.textContent).toBe("")

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
    await renderControl({ subscribe: () => Effect.fail(new AlreadySubscribed({ message: "Already." })) })

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

  it.each([
    new TermNotOpen({ message: "Seat alerts for Spring 2027 start when registration opens." }),
    new AddDeadlinePassed({ message: "The last day to add CS 161 (CRN 33940) was Sunday, January 17, 2027." })
  ])("shows the server's refusal ($_tag) as it is", async (refusal) => {
    await signedIn()
    await renderControl({ subscribe: () => Effect.fail(refusal) })

    fireEvent.click(notifyButton())

    const message = await screen.findByText(refusal.message)
    expect(message.closest("[role=alert]")).not.toBeNull()
    expect(notifyButton()).toBeDefined()
  })
})

describe("NotifyControl, in step with the rest of the extension", () => {
  it("shows Watching straight away for a class the user already watches, without a request", async () => {
    await signedIn([INTRO])
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByText(/We'll email you/)).toBeNull()
    expect(calls).toEqual([])
    expect(stopButton()).toBeDefined()
  })

  it("shows Notify me for a class the user does not watch, whatever else they watch", async () => {
    await signedIn([{ term: "202702", crn: "53476" }, INTRO_IN_FALL])
    await renderControl({ subscribe: () => Effect.void })
    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
  })

  it("goes back to Notify me when the alert is stopped in the popup, and can subscribe again", async () => {
    await signedIn()
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    fireEvent.click(notifyButton())
    await screen.findByRole("button", { name: "Watching" })

    await run(unsubscribe(INTRO))

    const button = await screen.findByRole("button", { name: "Notify me" })
    expect(button.getAttribute("aria-disabled")).toBeNull()
    expect(screen.queryByText(/We'll email you/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()

    fireEvent.click(button)
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.classId)).toEqual([INTRO, INTRO])
  })

  it("goes back to Notify me when another account signs in, and subscribes for that account", async () => {
    await signedIn()
    const { calls, run } = await renderControl({ subscribe: () => Effect.void, signIn: "other-token" })
    fireEvent.click(notifyButton())
    await screen.findByRole("button", { name: "Watching" })

    await run(signIn("other@oregonstate.edu", "012345"))

    fireEvent.click(await screen.findByRole("button", { name: "Notify me" }))
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.token)).toEqual([token, "other-token"])
  })

  it("says nothing about an earlier press once the popup has changed things since", async () => {
    await signedIn([INTRO])
    let online = false
    const { run } = await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: () => (online ? Effect.void : Effect.fail(new NetworkError({ cause: "offline" })))
    })

    fireEvent.click(stopButton())
    await screen.findByText(/Couldn't reach the server/)
    online = true
    await run(unsubscribe(INTRO))
    fireEvent.click(await screen.findByRole("button", { name: "Notify me" }))

    await screen.findByText(WATCHING_LINE)
    expect(screen.queryByRole("alert")?.textContent).toBe("")

    fireEvent.click(stopButton())
    await screen.findByText("Alerts stopped for this class.")
    fireEvent.click(notifyButton())
    await screen.findByText(WATCHING_LINE)
    await run(unsubscribe(INTRO))
    await screen.findByRole("button", { name: "Notify me" })
    expect(screen.queryByRole("status")?.textContent).toBe("")
  })

  it("goes back to Notify me when the user signs out", async () => {
    await signedIn([INTRO])
    await renderControl({ subscribe: () => Effect.void })
    await screen.findByRole("button", { name: "Watching" })

    await fakeBrowser.storage.local.clear()

    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
  })
})

describe("NotifyControl, stopping alerts", () => {
  it("offers no way to stop what is not being watched", async () => {
    await signedIn([{ term: "202702", crn: "53476" }])
    await renderControl({ subscribe: () => Effect.void })
    expect(notifyButton()).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()
  })

  it("stops the alert, goes back to Notify me, says so, and keeps the keyboard", async () => {
    await signedIn([INTRO])
    const { calls, stopCalls } = await renderControl({ subscribe: () => Effect.void })
    expect(stopButton().tagName).toBe("BUTTON")
    expect(stopButton().hasAttribute("disabled")).toBe(false)

    stopButton().focus()
    fireEvent.click(stopButton())

    const button = await screen.findByRole("button", { name: "Notify me" })
    expect(stopCalls).toEqual([{ classId: INTRO, token }])
    expect(screen.queryByRole("button", { name: "Stop alerts" })).toBeNull()
    expect(screen.getByText("Alerts stopped for this class.").closest("[role=status]")).not.toBeNull()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByText("Alerts stopped for this class.")).toBeNull()
    expect(screen.getByText(WATCHING_LINE)).toBeDefined()
    expect(calls).toHaveLength(1)
  })

  it("puts a stale Watching right: the alert was already stopped somewhere else", async () => {
    await signedIn([INTRO])
    await renderControl({
      subscribe: () => Effect.void,
      unsubscribe: () => Effect.fail(new NotSubscribed({ message: "You don't get alerts for this class." }))
    })

    fireEvent.click(stopButton())

    expect(await screen.findByRole("button", { name: "Notify me" })).toBeDefined()
    expect(screen.queryByRole("alert")?.textContent).toBe("")
  })

  it("is busy while the request is on its way, and ignores more presses", async () => {
    await signedIn([INTRO])
    const { stopCalls } = await renderControl({ subscribe: () => Effect.void, unsubscribe: () => Effect.never })

    fireEvent.click(stopButton())
    await expect.poll(() => stopButton().getAttribute("aria-busy")).toBe("true")
    fireEvent.click(stopButton())

    expect(stopCalls).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Watching" })).toBeDefined()
  })

  it("stays Watching and says why when stopping fails, and can be tried again", async () => {
    await signedIn([INTRO])
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

  it("says so, without the sign-in popover, when the server no longer accepts the sign-in", async () => {
    await signedIn([INTRO])
    const { run } = await renderControl({ subscribe: () => Effect.void, unsubscribe: () => Effect.fail(notSignedIn) })

    fireEvent.click(stopButton())

    expect(await screen.findByText(notSignedIn.message)).toBeDefined()
    expect(notifyButton()).toBeDefined()
    expect(screen.queryByText("Alerts stopped for this class.")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()

    await run(signIn(email, "012345"))
    await expect.poll(() => screen.queryByText(notSignedIn.message)).toBeNull()
  })
})

describe("NotifyControl, sign-in popover", () => {
  it("asks a signed-out user to sign in, in a frame showing the extension's own page", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })

    const popover = await openPopover()
    expect(popover.textContent).toContain("Sign in to get an email when a seat opens or the class fills up.")
    expect(signInFrame().src).toBe(fakeBrowser.runtime.getURL("/signin.html"))
    expect(document.querySelectorAll("input")).toHaveLength(0)
    expect(calls).toEqual([])
  })

  it("subscribes without a second press once the user has signed in in its frame", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    await run(signIn(email, "012345"))
    postToPage(SIGNED_IN)

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(calls).toEqual([{ classId: INTRO, token }])
    await expect.poll(() => document.activeElement).toBe(screen.getByRole("button", { name: "Watching" }))
  })

  it("asks to sign in when the server no longer accepts the saved sign-in, and continues with the new one", async () => {
    await signedIn()
    const { calls, run } = await renderControl({
      subscribe: (token) => (token === "student-token" ? Effect.fail(notSignedIn) : Effect.void),
      signIn: "new-token"
    })

    const popover = await openPopover()
    expect(popover.textContent).toContain("Sign in to get an email when a seat opens or the class fills up.")
    expect(screen.queryByText(notSignedIn.message)).toBeNull()

    await run(signIn(email, "012345"))
    postToPage(SIGNED_IN)

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.token)).toEqual(["student-token", "new-token"])
  })

  it("continues when the sign-in saved by the frame is the one already saved", async () => {
    const { calls } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    // Chrome reports no storage change when the frame saves the same sign-in again.
    await signedIn()

    postToPage(SIGNED_IN)

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls).toEqual([{ classId: INTRO, token }])
  })

  it("closes, and does not subscribe, when the user signs in somewhere else while the popover is open", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()

    await run(signIn(email, "012345"))
    await settled()
    expect(screen.getByRole("dialog")).toBeDefined()
    postToPage({ type: "getthedamclass/close" })

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(notifyButton().getAttribute("aria-expanded")).toBeNull()
    expect(screen.queryByRole("alert")?.textContent).toBe("")
    await settled()
    expect(calls).toEqual([])
    expect(notifyButton()).toBeDefined()
  })

  it("drops the request when the control is gone before the sign-in finishes", async () => {
    const { calls, run, unmount } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const frame = signInFrame().contentWindow

    unmount()
    await run(signIn(email, "012345"))
    postToPage(SIGNED_IN, { source: frame })
    await settled()

    expect(calls).toEqual([])
  })

  it("does not subscribe by itself when the user signs in after closing the popover", async () => {
    const { calls, run } = await renderControl({ subscribe: () => Effect.void })
    await openPopover()
    const frame = signInFrame().contentWindow
    fireEvent.click(notifyButton())

    await run(signIn(email, "012345"))
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

    postToPage({ type: "getthedamclass/close" }, { source: window })
    postToPage({ type: "getthedamclass/close" }, { origin: "https://classes.oregonstate.edu" })
    postToPage({ type: "getthedamclass/resize", height: 9999 }, { origin: "https://classes.oregonstate.edu" })
    postToPage(SIGNED_IN, { source: window })
    postToPage(SIGNED_IN, { origin: "https://classes.oregonstate.edu" })
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
