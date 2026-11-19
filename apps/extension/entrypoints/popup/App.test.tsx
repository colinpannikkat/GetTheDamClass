// @vitest-environment happy-dom
import { type Alert, InvalidCode, NotSignedIn, NotSubscribed } from "@getthedamclass/shared/domain"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { alertLabel, type ClassId, NetworkError } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { App } from "./App"

const email = "student@oregonstate.edu"
const token = "student-token"

const deepLearning: Alert = { term: "202702", crn: "39835", title: "INTRO TO DEEP LEARNING" }
const ethics: Alert = { term: "202702", crn: "37429", title: "ETHICS IN COMPUTING" }
/** The same CRN as `deepLearning`, in the term before: another class. */
const fallClass: Alert = { term: "202701", crn: "39835", title: "DATA STRUCTURES" }

const notSignedIn = new NotSignedIn({ message: "You're not signed in. Sign in with your email to continue." })

/** Render the popup with a fake server. Storage is WXT's in-memory `browser`. */
function renderPopup(fakeApi: Layer.PartialEffectful<Api["Service"]> = {}) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))
  return render(
    <RuntimeContext value={runtime}>
      <App />
    </RuntimeContext>
  )
}

/** As if the user signed in earlier. */
const signedIn = () => fakeBrowser.storage.local.set({ email, token })

/** The classes saved as watched, which is what the "Notify me" button on the class page goes by. */
const savedWatching = () =>
  Effect.runPromise(
    Effect.gen(function*() {
      const store = yield* AccountStore
      const saved = yield* store.get
      return saved.status === "signedIn" ? saved.watching.map(({ term, crn }) => `${term}/${crn}`).sort() : []
    }).pipe(Effect.provide(AccountStore.layer))
  )

/** The "Stop" button of a class, found by its full name for screen readers. */
const stopButton = (alert: Alert) => screen.getByRole("button", { name: `Stop alerts for ${alertLabel(alert)}` })

const emailField = () => screen.getByLabelText("Email") as HTMLInputElement

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("signed out", () => {
  it("says what the extension does and shows the sign-in form", async () => {
    renderPopup()
    expect(await screen.findByText(/get an email when a seat opens or the class fills up/)).toBeDefined()
    expect(emailField()).toBeDefined()
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeDefined()
    expect(screen.queryByText("Sign out")).toBeNull()
    // Nobody signed out just now, so there is nothing to say about that.
    expect(screen.queryByText(/Your alerts keep running/)).toBeNull()
  })

  it("switches to the list after both steps of signing in", async () => {
    const asked: Array<string> = []
    renderPopup({
      sendCode: () => Effect.void,
      signIn: () => Effect.succeed(token),
      listAlerts: (token) => Effect.sync(() => (asked.push(token), [deepLearning]))
    })
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } })
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }))
    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "012345" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.getByText(email)).toBeDefined()
    expect(screen.queryByLabelText("6-digit code")).toBeNull()
    expect(asked).toEqual([token])
  })

  it("is at the code step again when opened after switching to the inbox", async () => {
    const view = renderPopup({ sendCode: () => Effect.void })
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } })
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }))
    await screen.findByLabelText("6-digit code")

    // The browser closes the popup when the student clicks away from it.
    view.unmount()
    renderPopup({ signIn: () => Effect.succeed(token), listAlerts: () => Effect.succeed([]) })

    expect(await screen.findByLabelText("6-digit code")).toBeDefined()
    expect(screen.getByText(`We sent it to ${email}. It works for 15 minutes.`)).toBeDefined()
  })

  it("is at the email step when the code asked for has expired", async () => {
    await fakeBrowser.storage.local.set({ codeRequest: { email, sentAt: Date.now() - 16 * 60_000 } })
    renderPopup()
    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(screen.queryByLabelText("6-digit code")).toBeNull()
  })

  it("after an update from the version with PINs: signed out, the PIN gone, the email filled in", async () => {
    await fakeBrowser.storage.local.set({ email, pin: "1234", "watch:202702:student@oregonstate.edu:39835": true })
    renderPopup()

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(await fakeBrowser.storage.local.get()).toEqual({ email })
  })
})

describe("signed in", () => {
  beforeEach(signedIn)

  it("shows a placeholder while the list loads", async () => {
    renderPopup({ listAlerts: () => Effect.never })
    expect(await screen.findByText("Loading your classes…")).toBeDefined()
    expect(screen.getByText(email)).toBeDefined()
  })

  it("lists the classes with their CRN, term and a count", async () => {
    const asked: Array<string> = []
    renderPopup({ listAlerts: (token) => Effect.sync(() => (asked.push(token), [deepLearning, ethics])) })

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.getByText("CRN 39835 · Winter 2027")).toBeDefined()
    expect(screen.getByText("CRN 37429 · Winter 2027")).toBeDefined()
    expect(screen.getByRole("heading", { name: "Classes you're watching 2" })).toBeDefined()
    expect(asked).toEqual([token])
  })

  it("tells apart the same CRN in two terms", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning, fallClass]) })

    expect(await screen.findByText("CRN 39835 · Fall 2026")).toBeDefined()
    expect(screen.getByText("CRN 39835 · Winter 2027")).toBeDefined()
    expect(stopButton(deepLearning)).not.toBe(stopButton(fallClass))
  })

  it("shows the CRN alone for a term code it cannot name", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([{ ...ethics, term: "202709" }]) })
    expect(await screen.findByText("CRN 37429")).toBeDefined()
  })

  it("explains how to add a class when there are none", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([]) })

    expect(await screen.findByText(/open it on classes.oregonstate.edu and press "Notify me"/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Open class search" }))
    await expect.poll(async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url))
      .toContain("https://classes.oregonstate.edu/")
  })

  it("shows why the list did not load, and loads it on \"Try again\"", async () => {
    let online = false
    renderPopup({
      listAlerts: () => (online ? Effect.succeed([deepLearning]) : Effect.fail(new NetworkError({ cause: "offline" })))
    })

    const message = await screen.findByText(/Couldn't reach the server/)
    expect(message.closest("[role=alert]")).not.toBeNull()

    online = true
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("goes back to the sign-in form, with the email filled in, when the server no longer accepts the sign-in", async () => {
    renderPopup({ listAlerts: () => Effect.fail(notSignedIn) })

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull()
    expect(await fakeBrowser.storage.local.get()).toEqual({ email })
  })

  it("signs out on the server and here, goes back to the sign-in form, and says that the alerts keep running", async () => {
    const ended: Array<string> = []
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning]),
      signOut: (token) => Effect.sync(() => void ended.push(token))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(screen.queryByText("INTRO TO DEEP LEARNING")).toBeNull()
    expect(ended).toEqual([token])
    expect(await fakeBrowser.storage.local.get()).toEqual({})
    const note = await screen.findByText(/Your alerts keep running/)
    expect(note.textContent).toContain("sign in again and press Stop")
    expect(note.textContent).toContain("the link in any email about it")
  })

  it("signs out here even when the server cannot be reached", async () => {
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning]),
      signOut: () => Effect.fail(new NetworkError({ cause: "offline" }))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("saves which classes are watched, term and all, for the \"Notify me\" button on the class page", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning, fallClass]) })
    await screen.findByText("INTRO TO DEEP LEARNING")
    await expect.poll(savedWatching).toEqual(["202701/39835", "202702/39835"])
  })
})

describe("stopping a class", () => {
  beforeEach(signedIn)

  it("removes the row once the server has confirmed", async () => {
    const stopped: Array<[string, ClassId]> = []
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning, ethics]),
      unsubscribe: (token, classId) => Effect.sync(() => void stopped.push([token, classId]))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton(deepLearning))

    // The message names the class, so stopping the wrong one is noticed.
    const message = await screen.findByText(/Stopped alerts for INTRO TO DEEP LEARNING \(CRN 39835, Winter 2027\)/)
    expect(message.closest("[role=status]")).not.toBeNull()
    expect(screen.queryByText("INTRO TO DEEP LEARNING")).toBeNull()
    expect(screen.getByText("ETHICS IN COMPUTING")).toBeDefined()
    const heading = screen.getByRole("heading", { name: "Classes you're watching 1" })
    // Keyboard focus moves to the heading instead of vanishing with the row.
    expect(document.activeElement).toBe(heading)
    expect(stopped).toEqual([[token, deepLearning]])
    expect(await savedWatching()).toEqual(["202702/37429"])
  })

  it("tells two sections of one course apart by CRN", async () => {
    const stopped: Array<string> = []
    renderPopup({
      listAlerts: () =>
        Effect.succeed([
          { term: "202702", crn: "51625", title: "INTRODUCTION TO COMPUTER SCIENCE I" },
          { term: "202702", crn: "53476", title: "INTRODUCTION TO COMPUTER SCIENCE I" }
        ]),
      unsubscribe: (_token, classId) => Effect.sync(() => void stopped.push(classId.crn))
    })
    await screen.findByText("CRN 51625 · Winter 2027")

    // Each button has a name of its own (`getByRole` fails when two match).
    fireEvent.click(
      screen.getByRole("button", { name: "Stop alerts for INTRODUCTION TO COMPUTER SCIENCE I (CRN 53476, Winter 2027)" })
    )

    await screen.findByRole("heading", { name: "Classes you're watching 1" })
    expect(stopped).toEqual(["53476"])
    expect(screen.getByText("CRN 51625 · Winter 2027")).toBeDefined()
  })

  it("stops only the term it was pressed for when a CRN is in two terms", async () => {
    const stopped: Array<ClassId> = []
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning, fallClass]),
      unsubscribe: (_token, classId) => Effect.sync(() => void stopped.push(classId))
    })
    await screen.findByText("DATA STRUCTURES")

    fireEvent.click(stopButton(fallClass))

    await screen.findByRole("heading", { name: "Classes you're watching 1" })
    expect(stopped).toEqual([fallClass])
    expect(screen.getByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(await savedWatching()).toEqual(["202702/39835"])
  })

  it("shows the empty state after the last class is stopped", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning]), unsubscribe: () => Effect.void })
    fireEvent.click(await screen.findByRole("button", { name: `Stop alerts for ${alertLabel(deepLearning)}` }))

    expect(await screen.findByRole("button", { name: "Open class search" })).toBeDefined()
  })

  it("shows a busy button while the request is on its way", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning, ethics]), unsubscribe: () => Effect.never })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton(deepLearning))

    await expect.poll(() => stopButton(deepLearning).getAttribute("aria-busy")).toBe("true")
    // Busy buttons keep the keyboard: they are not `disabled`.
    expect(stopButton(deepLearning).hasAttribute("disabled")).toBe(false)
    // Only that row is busy.
    expect(stopButton(ethics).getAttribute("aria-busy")).toBeNull()
  })

  it("keeps the row and shows the reason when the request fails", async () => {
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning, ethics]),
      unsubscribe: () => Effect.fail(new NetworkError({ cause: "offline" }))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton(deepLearning))

    const message = await screen.findByText(/Couldn't reach the server/)
    expect(message.closest("[role=alert]")).not.toBeNull()
    // The error is inside the row it belongs to, and the row is still there.
    expect(message.closest("li")).toBe(screen.getByText("INTRO TO DEEP LEARNING").closest("li"))
    expect(screen.getByRole("heading", { name: "Classes you're watching 2" })).toBeDefined()
    expect(screen.queryByText(/Stopped alerts/)).toBeNull()
    // "Stop" can be pressed again.
    expect(stopButton(deepLearning).getAttribute("aria-disabled")).toBeNull()
  })

  it("removes the row when the alerts were already stopped somewhere else", async () => {
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning, ethics]),
      unsubscribe: () => Effect.fail(new NotSubscribed({ message: "You don't get alerts for this class." }))
    })
    await screen.findByText("INTRO TO DEEP LEARNING")

    fireEvent.click(stopButton(ethics))

    expect(await screen.findByRole("heading", { name: "Classes you're watching 1" })).toBeDefined()
    expect(await screen.findByText(/Stopped alerts for ETHICS IN COMPUTING/)).toBeDefined()
    // No error is shown anywhere: the user got what they asked for.
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent).join("")).toBe("")
  })

  it("goes back to the sign-in form when the server no longer accepts the sign-in", async () => {
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning]), unsubscribe: () => Effect.fail(notSignedIn) })
    fireEvent.click(await screen.findByRole("button", { name: `Stop alerts for ${alertLabel(deepLearning)}` }))

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(emailField().value).toBe(email)
  })
})

describe("deleting the account", () => {
  beforeEach(signedIn)

  /** Press the small link and wait for the question. */
  async function askToDelete() {
    fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }))
    return screen.getByRole("group", { name: /Delete your account\?/ })
  }

  it("asks first, saying what it does, with the keyboard on Cancel", async () => {
    let calls = 0
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning]), deleteAccount: () => Effect.sync(() => void calls++) })

    const question = await askToDelete()

    expect(question.textContent).toContain("This stops all your alerts and signs you out everywhere. It can't be undone.")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }))
    expect(calls).toBe(0)
  })

  it("does nothing on Cancel", async () => {
    let calls = 0
    renderPopup({ listAlerts: () => Effect.succeed([deepLearning]), deleteAccount: () => Effect.sync(() => void calls++) })
    await askToDelete()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("group")).toBeNull()
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDefined()
    expect(calls).toBe(0)
    expect(await fakeBrowser.storage.local.get()).toMatchObject({ email, token })
  })

  it("deletes it on the server, forgets everything here, and says so on the sign-in screen", async () => {
    const deleted: Array<string> = []
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning]),
      deleteAccount: (token) => Effect.sync(() => void deleted.push(token))
    })
    await askToDelete()

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))

    expect(await screen.findByText("Your account and all its alerts are deleted.")).toBeDefined()
    expect(screen.getByLabelText("Email")).toBeDefined()
    expect(screen.queryByText(/Your alerts keep running/)).toBeNull()
    expect(deleted).toEqual([token])
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("stays signed in, and says why, when the server could not delete it", async () => {
    renderPopup({
      listAlerts: () => Effect.succeed([deepLearning]),
      deleteAccount: () => Effect.fail(new NetworkError({ cause: "offline" }))
    })
    await askToDelete()

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))

    const message = await screen.findByText(/Couldn't reach the server/)
    expect(message.closest("[role=group]")).not.toBeNull()
    expect(screen.getByText("INTRO TO DEEP LEARNING")).toBeDefined()
    expect(await fakeBrowser.storage.local.get()).toMatchObject({ email, token })
  })
})

describe("the sign-in form's refusals", () => {
  it("shows the server's sentence for a wrong code as it is", async () => {
    await fakeBrowser.storage.local.set({ codeRequest: { email, sentAt: Date.now() } })
    renderPopup({ signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right, or it has expired." })) })

    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "999999" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByText("That code isn't right, or it has expired.")).toBeDefined()
  })
})
