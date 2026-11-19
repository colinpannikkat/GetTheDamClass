// @vitest-environment happy-dom
import { CodeRecentlySent, EmailNotSent, InvalidCode } from "@getthedamclass/shared/domain"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "@/lib/AccountStore"
import { Api } from "@/lib/Api"
import { NetworkError } from "@/lib/domain"
import { RuntimeContext, useAccount } from "@/lib/react"
import { SignInForm } from "./SignInForm"

const email = "student@oregonstate.edu"
const token = "student-token"

/**
 * The form the way the popup and the sign-in frame use it: started from what
 * is saved. Storage is WXT's in-memory `browser`.
 */
function SavedSignInForm({ autoFocus, onSignedIn }: { readonly autoFocus: boolean; readonly onSignedIn?: () => void }) {
  const account = useAccount()
  if (account.status !== "signedOut") {
    return <p>{account.status}</p>
  }
  return (
    <SignInForm autoFocus={autoFocus} email={account.email} codeRequest={account.codeRequest} onSignedIn={onSignedIn} />
  )
}

/**
 * Render the form with a fake server, and wait for its first field. Like the
 * frame, it asks for the keyboard; `{ autoFocus: false }` renders it the way
 * the popup does.
 */
async function renderForm(
  fakeApi: Layer.PartialEffectful<Api["Service"]>,
  onSignedIn?: () => void,
  { autoFocus = true }: { readonly autoFocus?: boolean } = {}
) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))
  const view = render(
    <RuntimeContext value={runtime}>
      <SavedSignInForm autoFocus={autoFocus} onSignedIn={onSignedIn} />
    </RuntimeContext>
  )
  await screen.findByRole("textbox")
  return view
}

const emailField = () => screen.getByLabelText("Email") as HTMLInputElement
const codeField = () => screen.getByLabelText("6-digit code") as HTMLInputElement

function askForCode(typed: string) {
  fireEvent.change(emailField(), { target: { value: typed } })
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }))
}

function enterCode(typed: string) {
  fireEvent.change(codeField(), { target: { value: typed } })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

/** As if a code was asked for this many minutes ago (in the popup, which was then closed). */
const askedMinutesAgo = (minutes: number) =>
  fakeBrowser.storage.local.set({ codeRequest: { email, requestedAt: Date.now() - minutes * 60_000 } })

/** The text of every error message on screen. */
const errors = () => screen.getAllByRole("alert").map((alert) => alert.textContent).join("")

/** Wait a moment, before checking that something did NOT happen. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("the email step", () => {
  it("says in a few words that there is no password and nothing else to sign up for", async () => {
    await renderForm({})
    expect(screen.getByText("We'll email you a code. No password, and no separate sign-up.")).toBeDefined()
    expect(document.activeElement).toBe(emailField())
  })

  it("asks the server for a code, for the address as the server expects it, then moves to the code step", async () => {
    const asked: Array<string> = []
    await renderForm({ sendCode: (email) => Effect.sync(() => void asked.push(email)) })

    askForCode("  Student@OregonState.EDU ")

    expect(await screen.findByLabelText("6-digit code")).toBeDefined()
    expect(asked).toEqual([email])
    expect(screen.getByText(`Check ${email} for the code. It works for 15 minutes.`)).toBeDefined()
    expect(document.activeElement).toBe(codeField())
  })

  it("does not call the first code a new one", async () => {
    await renderForm({ sendCode: () => Effect.void })

    askForCode(email)

    // The hint changes once the server has answered.
    await screen.findByText(`Check ${email} for the code. It works for 15 minutes.`)
    await settled()
    expect(screen.queryByText(`We sent a new code to ${email}.`)).toBeNull()
  })

  it.each(["", "student", "student@", "two words@example.com"])(
    "says what is wrong with %j, and does not call the server",
    async (typed) => {
      let calls = 0
      await renderForm({ sendCode: () => Effect.sync(() => void calls++) })

      askForCode(typed)

      const message = await screen.findByText("Enter your whole email address, like you@example.com.")
      expect(message.closest("[role=alert]")).not.toBeNull()
      expect(calls).toBe(0)
      expect(emailField()).toBeDefined()
    }
  )

  it("shows the server's refusal as it is, and stays at this step", async () => {
    await renderForm({ sendCode: () => Effect.fail(new EmailNotSent({ message: "We couldn't send the email." })) })

    askForCode(email)

    expect(await screen.findByText("We couldn't send the email.")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("moves to the code step, and shows the server's sentence there, when a code went to this address less than a minute ago", async () => {
    // That code may be in the inbox (asked for in the popup, which was closed
    // before the answer came), or already used, in which case no email is
    // coming: the sentence says why, and when to ask again.
    const sentence =
      "A code went to this address less than a minute ago. Please wait a minute before asking for another."
    await renderForm({ sendCode: () => Effect.fail(new CodeRecentlySent({ message: sentence })) })

    askForCode(email)

    expect(await screen.findByLabelText("6-digit code")).toBeDefined()
    expect((await screen.findByText(sentence)).closest("[role=alert]")).not.toBeNull()
  })

  it("is at the code step while the code is on its way, and asks only once", async () => {
    let calls = 0
    await renderForm({ sendCode: () => Effect.andThen(Effect.sync(() => calls++), Effect.never) })

    askForCode(email)

    expect(await screen.findByText(`Sending a code to ${email}…`)).toBeDefined()
    const resend = screen.getByRole("button", { name: "Send a new code" })
    expect(resend.getAttribute("aria-busy")).toBe("true")
    fireEvent.click(resend)
    expect(calls).toBe(1)
  })

  it("starts with the address last used here", async () => {
    await fakeBrowser.storage.local.set({ email })
    await renderForm({})
    expect(emailField().value).toBe(email)
  })
})

describe("the code step", () => {
  it("signs in with the code, saves the token and tells its parent", async () => {
    const sent: Array<[string, string]> = []
    let told = 0
    await askedMinutesAgo(1)
    await renderForm(
      { signIn: (email, code) => Effect.sync(() => (sent.push([email, code]), token)) },
      () => told++
    )

    enterCode("012345")

    await expect.poll(() => told).toBe(1)
    expect(sent).toEqual([[email, "012345"]])
    expect(await fakeBrowser.storage.local.get()).toEqual({ email, token })
  })

  it("makes typing the code easy on a phone, and lets the browser fill it in", async () => {
    await askedMinutesAgo(1)
    await renderForm({})
    expect(codeField().getAttribute("inputmode")).toBe("numeric")
    expect(codeField().getAttribute("autocomplete")).toBe("one-time-code")
    expect(document.activeElement).toBe(codeField())
  })

  it("only lets six digits into the field, so a pasted \"123 456\" works", async () => {
    await askedMinutesAgo(1)
    await renderForm({})
    fireEvent.change(codeField(), { target: { value: "123 456" } })
    expect(codeField().value).toBe("123456")
    fireEvent.change(codeField(), { target: { value: "1a2b3c4d5e6f7g" } })
    expect(codeField().value).toBe("123456")
  })

  it("says the code is too short, and does not call the server", async () => {
    let calls = 0
    await askedMinutesAgo(1)
    await renderForm({ signIn: () => Effect.sync(() => (calls++, token)) })

    enterCode("1234")

    expect(await screen.findByText("Enter the 6 digits from the email.")).toBeDefined()
    expect(calls).toBe(0)
  })

  it("shows the server's refusal of a wrong code as it is, and saves nothing", async () => {
    let told = 0
    await askedMinutesAgo(1)
    await renderForm(
      { signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right, or it has expired." })) },
      () => told++
    )

    enterCode("999999")

    const message = await screen.findByText("That code isn't right, or it has expired.")
    expect(message.closest("[role=alert]")).not.toBeNull()
    expect(told).toBe(0)
    expect(await fakeBrowser.storage.local.get()).not.toHaveProperty("token")
  })

  it("sends a new code to the same address, says so, and clears the digits typed from the old one", async () => {
    const asked: Array<string> = []
    await askedMinutesAgo(2)
    await renderForm({ sendCode: (email) => Effect.sync(() => void asked.push(email)) })
    fireEvent.change(codeField(), { target: { value: "012345" } })

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))

    const message = await screen.findByText(`We sent a new code to ${email}.`)
    expect(message.closest("[role=status]")).not.toBeNull()
    expect(asked).toEqual([email])
    expect(codeField().value).toBe("")
  })

  it("shows the server's sentence when a new code is asked for within the minute, and keeps the first code's time", async () => {
    const sentence =
      "A code went to this address less than a minute ago. Please wait a minute before asking for another."
    await askedMinutesAgo(0)
    const before = await fakeBrowser.storage.local.get()
    await renderForm({ sendCode: () => Effect.fail(new CodeRecentlySent({ message: sentence })) })
    fireEvent.change(codeField(), { target: { value: "012345" } })

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))

    expect(await screen.findByText(sentence)).toBeDefined()
    // Still at the code step, with what was typed: the earlier code works,
    // for 15 minutes from when it was asked for.
    expect(codeField().value).toBe("012345")
    expect(await fakeBrowser.storage.local.get()).toEqual(before)
  })

  it("goes back to the email step, with the server's sentence and the address, when the new code's email could not be sent", async () => {
    // The server replaced the earlier code before the email failed, and then
    // forgot the new one: no code works for this address any more.
    await askedMinutesAgo(2)
    await renderForm({ sendCode: () => Effect.fail(new EmailNotSent({ message: "We couldn't send the email." })) })

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))

    expect(await screen.findByText("We couldn't send the email.")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("shows why a new code failed on the email step, when the form was left open past the code's 15 minutes", async () => {
    await askedMinutesAgo(14)
    await renderForm({ sendCode: () => Effect.fail(new NetworkError({ cause: "offline" })) })
    // Two minutes on: nothing has read the saved request since, so the form
    // still shows its code step.
    const later = Date.now() + 2 * 60_000
    vi.spyOn(Date, "now").mockReturnValue(later)

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))

    expect(await screen.findByText("Couldn't reach the server. Check your connection and try again.")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("lets a late refusal of a new code change nothing once the student went on to a different email", async () => {
    // The server is asked once the new request is saved, and answers when
    // the test says.
    let asked = () => {}
    const serverAsked = new Promise<void>((resolve) => (asked = resolve))
    let refuse = () => {}
    const refused = new Promise<void>((resolve) => (refuse = resolve))
    await askedMinutesAgo(2)
    await renderForm({
      sendCode: () =>
        Effect.sync(asked).pipe(
          Effect.andThen(Effect.promise(() => refused)),
          Effect.andThen(Effect.fail(new NetworkError({ cause: "offline" })))
        )
    })

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))
    await serverAsked
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }))
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "other@oregon" } })
    refuse()
    await settled()

    expect(emailField().value).toBe("other@oregon")
    expect(screen.queryByLabelText("6-digit code")).toBeNull()
    expect(errors()).toBe("")
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("shows only the newest answer: a refused code, then a new one sent", async () => {
    await askedMinutesAgo(2)
    await renderForm({
      sendCode: () => Effect.void,
      signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." }))
    })
    enterCode("999999")
    await screen.findByText("That code isn't right.")

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }))

    await screen.findByText(`We sent a new code to ${email}.`)
    expect(errors()).toBe("")
  })

  it("starts over when a code is asked for another address somewhere else (the popup, the class page)", async () => {
    await askedMinutesAgo(1)
    await renderForm({ signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." })) })
    enterCode("999999")
    await screen.findByText("That code isn't right.")

    await fakeBrowser.storage.local.set({ codeRequest: { email: "other@oregonstate.edu", requestedAt: Date.now() } })

    expect(await screen.findByText("Check other@oregonstate.edu for the code. It works for 15 minutes.")).toBeDefined()
    expect(codeField().value).toBe("")
    expect(errors()).toBe("")
  })

  it("goes back to the email step, with the address filled in, and forgets the code request", async () => {
    await askedMinutesAgo(1)
    await renderForm({})

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }))

    expect(await screen.findByLabelText("Email")).toBeDefined()
    expect(emailField().value).toBe(email)
    expect(document.activeElement).toBe(emailField())
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })
})

describe("closed and opened again", () => {
  it("opens at the code step for the address typed, while the code still works, with the keyboard in its field", async () => {
    await askedMinutesAgo(14)
    // The popup does not ask for the keyboard; the code step takes it all the same.
    await renderForm({}, undefined, { autoFocus: false })
    expect(codeField()).toBeDefined()
    expect(screen.getByText(`Check ${email} for the code. It works for 15 minutes.`)).toBeDefined()
    expect(document.activeElement).toBe(codeField())
  })

  it("opens at the code step when it was closed before the server answered", async () => {
    // The student switched to their inbox straight away, and the browser
    // closed the popup, and everything running in it, before the answer came.
    const view = await renderForm({ sendCode: () => Effect.never })
    askForCode(email)
    await settled()
    view.unmount()

    await renderForm({})

    expect(codeField()).toBeDefined()
    expect(screen.getByText(`Check ${email} for the code. It works for 15 minutes.`)).toBeDefined()
  })

  it("opens at the email step once the code's 15 minutes are over, and forgets the address the code went to", async () => {
    await askedMinutesAgo(15)
    await renderForm({})
    expect(emailField().value).toBe("")
    expect(screen.queryByLabelText("6-digit code")).toBeNull()
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })
})
