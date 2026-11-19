// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "@/lib/Api"
import { CredentialStore } from "@/lib/CredentialStore"
import { ClassNotFound, type Credentials, NetworkError, NotSubscribed, type Subscription, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { App } from "./App"

const student: Credentials = { email: "student@oregonstate.edu", pin: "1234" }

const deepLearning: Subscription = { crn: "39835", name: "INTRO TO DEEP LEARNING" }
const unnamed: Subscription = { crn: "37429", name: null }

/** Render the popup with a fake backend. Storage is WXT's in-memory `browser`. */
function renderPopup(fakeApi: Layer.PartialEffectful<Api["Service"]> = {}) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, fakeApi), CredentialStore.layer))
  return render(
    <RuntimeContext value={runtime}>
      <App />
    </RuntimeContext>
  )
}

/** As if the user signed in earlier. */
const signedIn = () => fakeBrowser.storage.local.set(student)

const stopButton = (label: string) => screen.getByRole("button", { name: `Stop alerts for ${label}` })

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("signed out", () => {
  it("says what the extension does and shows the sign-in form", async () => {
    renderPopup()
    expect(await screen.findByText(/Get an email when a seat opens up/)).toBeDefined()
    expect(screen.getByLabelText("Email")).toBeDefined()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined()
    expect(screen.queryByText("Sign out")).toBeNull()
  })

  it("switches to the list after signing in", async () => {
    renderPopup({
      signIn: () => Effect.succeed("loggedIn"),
      listSubscriptions: () => Effect.succeed([deepLearning])
    })
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: student.email } })
    fireEvent.change(screen.getByLabelText("4-digit PIN"), { target: { value: student.pin } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.getByText(student.email)).toBeDefined()
    expect(screen.queryByLabelText("Email")).toBeNull()
  })
})

describe("signed in", () => {
  beforeEach(signedIn)

  it("shows a placeholder while the list loads", async () => {
    renderPopup({ listSubscriptions: () => Effect.never })
    expect(await screen.findByText("Loading your classes…")).toBeDefined()
    expect(screen.getByText(student.email)).toBeDefined()
  })

  it("lists the classes with their CRN and a count", async () => {
    const asked: Array<Credentials> = []
    renderPopup({
      listSubscriptions: (credentials) => Effect.sync(() => (asked.push(credentials), [deepLearning, unnamed]))
    })

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.getByText("CRN 39835")).toBeDefined()
    // A class without a name is shown by its CRN (once, not twice).
    expect(screen.getAllByText("CRN 37429")).toHaveLength(1)
    expect(screen.getByRole("heading", { name: "Classes you're watching 2" })).toBeDefined()
    expect(screen.getByText(student.email)).toBeDefined()
    expect(asked).toEqual([student])
  })

  it("explains how to add a class when there are none", async () => {
    renderPopup({ listSubscriptions: () => Effect.succeed([]) })

    expect(await screen.findByText(/open it on classes.oregonstate.edu and press "Notify me"/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Open class search" }))
    await expect.poll(async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url))
      .toContain("https://classes.oregonstate.edu/")
  })

  it("shows why the list did not load, and loads it on \"Try again\"", async () => {
    let online = false
    renderPopup({
      listSubscriptions: () =>
        online ? Effect.succeed([deepLearning]) : Effect.fail(new NetworkError({ cause: "offline" }))
    })

    const message = await screen.findByText(/Couldn't reach the server/)
    expect(message.closest("[role=alert]")).not.toBeNull()
    expect(screen.queryByLabelText("Email")).toBeNull()

    online = true
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("asks to sign in again when the saved PIN is no longer accepted", async () => {
    renderPopup({
      signIn: () => Effect.succeed("loggedIn"),
      listSubscriptions: (credentials) =>
        credentials.pin === "5678"
          ? Effect.succeed([deepLearning])
          : Effect.fail(new WrongPin({ message: "User authentication failed" }))
    })

    expect(await screen.findByText(/Your saved PIN no longer works/)).toBeDefined()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: student.email } })
    fireEvent.change(screen.getByLabelText("4-digit PIN"), { target: { value: "5678" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.queryByText(/Your saved PIN no longer works/)).toBeNull()
  })

  it("signs out and goes back to the sign-in form", async () => {
    renderPopup({ listSubscriptions: () => Effect.succeed([deepLearning]) })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(screen.queryByText("INTRO TO DEEP LEARNING")).toBeNull()
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })
})

describe("stopping a class", () => {
  beforeEach(signedIn)

  it("removes the row once the server has confirmed", async () => {
    const stopped: Array<[string, Credentials]> = []
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning, unnamed]),
      unsubscribe: (crn, credentials) => Effect.sync(() => void stopped.push([crn, credentials]))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton("INTRO TO DEEP LEARNING"))

    // The message names the class, so stopping the wrong one is noticed.
    const message = await screen.findByText(/Stopped alerts for INTRO TO DEEP LEARNING/)
    expect(message.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByText("INTRO TO DEEP LEARNING")).toBeNull()
    expect(screen.getByText("CRN 37429")).toBeDefined()
    const heading = screen.getByRole("heading", { name: "Classes you're watching 1" })
    // Keyboard focus moves to the heading instead of vanishing with the row.
    expect(document.activeElement).toBe(heading)
    expect(stopped).toEqual([["39835", student]])
  })

  it("shows the empty state after the last class is stopped", async () => {
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning]),
      unsubscribe: () => Effect.void
    })
    fireEvent.click(await screen.findByRole("button", { name: "Stop alerts for INTRO TO DEEP LEARNING" }))

    expect(await screen.findByRole("button", { name: "Open class search" })).toBeDefined()
  })

  it("shows a busy button while the request is on its way", async () => {
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning, unnamed]),
      unsubscribe: () => Effect.never
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton("INTRO TO DEEP LEARNING"))

    await expect.poll(() => stopButton("INTRO TO DEEP LEARNING").getAttribute("aria-busy")).toBe("true")
    // Only that row is busy.
    expect(stopButton("CRN 37429").getAttribute("aria-busy")).toBeNull()
    expect(screen.getByText("INTRO TO DEEP LEARNING")).toBeDefined()
  })

  it("keeps the row and shows the reason when the request fails", async () => {
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning, unnamed]),
      unsubscribe: () => Effect.fail(new NetworkError({ cause: "offline" }))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton("INTRO TO DEEP LEARNING"))

    const message = await screen.findByText(/Couldn't reach the server/)
    expect(message.closest("[role=alert]")).not.toBeNull()
    // The error is inside the row it belongs to, and the row is still there.
    expect(message.closest("li")).toBe(screen.getByText("INTRO TO DEEP LEARNING").closest("li"))
    expect(screen.getByRole("heading", { name: "Classes you're watching 2" })).toBeDefined()
    expect(screen.queryByText(/Stopped alerts/)).toBeNull()
    // "Stop" can be pressed again.
    expect(stopButton("INTRO TO DEEP LEARNING").hasAttribute("disabled")).toBe(false)
  })

  it("explains a class from an earlier term that the server will not touch", async () => {
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning]),
      unsubscribe: (crn) => Effect.fail(new ClassNotFound({ crn, message: "CRN doesn't exist" }))
    })
    fireEvent.click(await screen.findByRole("button", { name: "Stop alerts for INTRO TO DEEP LEARNING" }))

    expect(await screen.findByText(/isn't in the current term/)).toBeDefined()
    expect(screen.getByText("INTRO TO DEEP LEARNING")).toBeDefined()
  })

  it("removes the row when the alerts were already stopped somewhere else", async () => {
    renderPopup({
      listSubscriptions: () => Effect.succeed([deepLearning, unnamed]),
      unsubscribe: (crn) => Effect.fail(new NotSubscribed({ crn, message: "Not subscribed to class" }))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton("CRN 37429"))

    expect(await screen.findByRole("heading", { name: "Classes you're watching 1" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop alerts for CRN 37429" })).toBeNull()
    // No error is shown anywhere: the user got what they asked for.
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent).join("")).toBe("")
  })
})
