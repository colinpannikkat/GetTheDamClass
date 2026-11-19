// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "@/lib/Api"
import { CredentialStore } from "@/lib/CredentialStore"
import { AlreadySubscribed, type Credentials, type Crn, NetworkError, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { findDetailsPanels, findPanelStack, readCrn } from "./detailsPanel"
import pageHtml from "./fixtures/details-panel.html?raw"
import { NotifyControl } from "./NotifyControl"

const student: Credentials = { email: "student@oregonstate.edu", pin: "1234" }

/** One call the fake backend received. */
interface SubscribeCall {
  readonly crn: Crn
  readonly credentials: Credentials
}

/**
 * Render the control with a fake backend. `subscribe` answers each press;
 * every call it gets is pushed onto the returned `calls`. Storage is WXT's
 * in-memory `browser`.
 */
function renderControl(options: {
  readonly subscribe: Api["Service"]["subscribe"]
  readonly signIn?: Api["Service"]["signIn"]
  readonly getCrn?: () => Option.Option<Crn>
}) {
  const calls: Array<SubscribeCall> = []
  const fakeApi = Layer.mock(Api, {
    signIn: options.signIn ?? (() => Effect.succeed("loggedIn")),
    subscribe: (crn, credentials) => {
      calls.push({ crn, credentials })
      return options.subscribe(crn, credentials)
    }
  })
  const runtime = ManagedRuntime.make(Layer.mergeAll(fakeApi, CredentialStore.layer))
  render(
    <RuntimeContext value={runtime}>
      <NotifyControl getCrn={options.getCrn ?? (() => Option.some("53476"))} />
    </RuntimeContext>
  )
  return calls
}

const signedIn = () => fakeBrowser.storage.local.set(student)
const notifyButton = () => screen.getByRole("button", { name: "Notify me" })

function fillAndSubmitSignIn(email: string, pin: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } })
  fireEvent.change(screen.getByLabelText("4-digit PIN"), { target: { value: pin } })
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("NotifyControl, signed in", () => {
  it("does not touch the backend until the button is pressed", async () => {
    await signedIn()
    const calls = renderControl({ subscribe: () => Effect.void })
    expect(notifyButton()).toBeDefined()
    expect(calls).toEqual([])
  })

  it("subscribes and settles into a calm Watching state", async () => {
    await signedIn()
    const calls = renderControl({ subscribe: () => Effect.void })

    fireEvent.click(notifyButton())

    const watching = await screen.findByRole("button", { name: "Watching" })
    expect(calls).toEqual([{ crn: "53476", credentials: student }])
    // The confirmation is announced politely, not as an alert.
    const note = screen.getByText("We'll email you when a seat opens.")
    expect(note.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByRole("alert")?.textContent).toBe("")

    // "Watching" can still be focused but pressing it does nothing more.
    expect(watching.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(watching)
    expect(calls).toHaveLength(1)
  })

  it("shows a spinner state while the request is on its way", async () => {
    await signedIn()
    let finish = () => {}
    const serverReplied = new Promise<void>((resolve) => (finish = resolve))
    renderControl({ subscribe: () => Effect.promise(() => serverReplied) })

    fireEvent.click(notifyButton())
    await expect.poll(() => notifyButton().getAttribute("aria-busy")).toBe("true")

    finish()
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
  })

  it("treats 'already subscribed' as the same Watching state, not as an error", async () => {
    await signedIn()
    renderControl({
      subscribe: (crn) => Effect.fail(new AlreadySubscribed({ crn, message: "Already subscribed" }))
    })

    fireEvent.click(notifyButton())

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    const note = screen.getByText("You're already getting alerts for this class.")
    expect(note.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByRole("alert")?.textContent).toBe("")
  })

  it("shows other failures inline and lets the user try again", async () => {
    await signedIn()
    let attempts = 0
    const calls = renderControl({
      subscribe: () => (++attempts === 1 ? Effect.fail(new NetworkError({ cause: "offline" })) : Effect.void)
    })

    fireEvent.click(notifyButton())
    const problem = await screen.findByText(/Couldn't reach the server/)
    expect(problem.closest("[role=alert]")).not.toBeNull()
    // The button is back, enabled and focused, ready for another press.
    expect(notifyButton().hasAttribute("disabled")).toBe(false)
    await expect.poll(() => document.activeElement).toBe(notifyButton())

    fireEvent.click(notifyButton())
    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it("sends the CRN the panel shows when the button is pressed, not the one it showed earlier", async () => {
    await signedIn()
    document.body.innerHTML = pageHtml
    const [panel] = findDetailsPanels(findPanelStack(document)!)
    const calls = renderControl({ subscribe: () => Effect.void, getCrn: () => readCrn(panel!) })

    // The user picks another section and the page rewrites the panel.
    panel!.querySelector(".dtl-section")!.textContent = "Section 400, CRN 51625"
    fireEvent.click(notifyButton())

    await screen.findByRole("button", { name: "Watching" })
    expect(calls.map((call) => call.crn)).toEqual(["51625"])
  })

  it("explains itself instead of calling the backend when the panel has no CRN", async () => {
    await signedIn()
    const calls = renderControl({ subscribe: () => Effect.void, getCrn: () => Option.none() })

    fireEvent.click(notifyButton())

    expect(await screen.findByText(/Couldn't find this section's CRN/)).toBeDefined()
    expect(calls).toEqual([])
  })
})

describe("NotifyControl, sign-in popover", () => {
  it("asks a signed-out user to sign in, then subscribes without a second press", async () => {
    const signIns: Array<Credentials> = []
    const calls = renderControl({
      signIn: (credentials) => Effect.sync(() => (signIns.push(credentials), "accountCreated" as const)),
      subscribe: () => Effect.void
    })

    fireEvent.click(notifyButton())

    // The popover opens with a line of context and the keyboard in its first field.
    const popover = await screen.findByRole("dialog", { name: "Sign in to get alerts" })
    expect(popover.textContent).toContain("Sign in to get an email when a seat opens in this class.")
    expect(document.activeElement).toBe(screen.getByLabelText("Email"))
    expect(calls).toEqual([]) // Signed out: nothing was sent.

    fillAndSubmitSignIn("student@oregonstate.edu", "1234")

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(signIns).toEqual([student])
    expect(calls).toEqual([{ crn: "53476", credentials: student }])
    expect(await fakeBrowser.storage.local.get()).toEqual(student)
  })

  it("asks again when the saved sign-in is rejected, and continues with the new one", async () => {
    await fakeBrowser.storage.local.set({ email: student.email, pin: "0000" })
    const calls = renderControl({
      subscribe: (_crn, credentials) =>
        credentials.pin === "0000" ? Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })) : Effect.void
    })

    fireEvent.click(notifyButton())

    const popover = await screen.findByRole("dialog")
    expect(popover.textContent).toContain("Your saved sign-in no longer works.")
    // It is not shown as an error next to the button as well.
    expect(screen.queryByText(/PIN doesn't match/)).toBeNull()

    fillAndSubmitSignIn(student.email, "1234")

    expect(await screen.findByRole("button", { name: "Watching" })).toBeDefined()
    expect(calls.map((call) => call.credentials.pin)).toEqual(["0000", "1234"])
  })

  it("keeps the popover open with the form's own error when signing in fails", async () => {
    const calls = renderControl({
      signIn: () => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })),
      subscribe: () => Effect.void
    })

    fireEvent.click(notifyButton())
    await screen.findByRole("dialog")
    fillAndSubmitSignIn(student.email, "9999")

    expect(await screen.findByText(/PIN doesn't match/)).toBeDefined()
    expect(screen.getByRole("dialog")).toBeDefined()
    expect(calls).toEqual([])
  })

  it("closes on Escape and gives focus back to the button", async () => {
    const calls = renderControl({ subscribe: () => Effect.void })

    fireEvent.click(notifyButton())
    await screen.findByRole("dialog")
    fireEvent.keyDown(screen.getByLabelText("Email"), { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
    await expect.poll(() => document.activeElement).toBe(notifyButton())
    // Closing is not a failure: no error message, and the button works again.
    expect(screen.queryByRole("alert")?.textContent).toBe("")
    expect(calls).toEqual([])

    fireEvent.click(notifyButton())
    expect(await screen.findByRole("dialog")).toBeDefined()
  })

  it("closes on a press outside, but not on a press inside", async () => {
    renderControl({ subscribe: () => Effect.void })

    fireEvent.click(notifyButton())
    await screen.findByRole("dialog")

    fireEvent.pointerDown(screen.getByLabelText("Email"))
    expect(screen.getByRole("dialog")).toBeDefined()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes when the button is pressed again", async () => {
    const calls = renderControl({ subscribe: () => Effect.void })

    fireEvent.click(notifyButton())
    await screen.findByRole("dialog")
    expect(notifyButton().getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(notifyButton())
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(calls).toEqual([])
  })
})
