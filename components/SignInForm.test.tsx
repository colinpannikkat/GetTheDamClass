// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "@/lib/Api"
import { AccountStore } from "@/lib/AccountStore"
import { type Credentials, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { SignInForm, type SignInFormProps } from "./SignInForm"

/** Render the form with a fake Api. Storage is WXT's in-memory `browser`. */
function renderForm(signIn: Api["Service"]["signIn"], props: SignInFormProps = {}) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, { signIn }), AccountStore.layer))
  return render(
    <RuntimeContext value={runtime}>
      <SignInForm {...props} />
    </RuntimeContext>
  )
}

function fillAndSubmit(email: string, pin: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } })
  fireEvent.change(screen.getByLabelText("4-digit PIN"), { target: { value: pin } })
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

beforeEach(() => {
  fakeBrowser.reset()
})
afterEach(cleanup)

describe("SignInForm", () => {
  it("signs in, saves the credentials and tells its parent", async () => {
    const sent: Array<Credentials> = []
    let told = 0
    renderForm((credentials) => Effect.sync(() => void sent.push(credentials)), { onSignedIn: () => told++ })

    fillAndSubmit("  student@oregonstate.edu ", "1234")

    await expect.poll(() => told).toBe(1)
    expect(sent).toEqual([{ email: "student@oregonstate.edu", pin: "1234" }])
    expect(await fakeBrowser.storage.local.get()).toMatchObject({ email: "student@oregonstate.edu", pin: "1234" })
  })

  it("shows a wrong PIN as an inline alert and saves nothing", async () => {
    let told = 0
    renderForm(() => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })), { onSignedIn: () => told++ })

    fillAndSubmit("student@oregonstate.edu", "9999")

    const message = await screen.findByText(/PIN doesn't match/)
    expect(message.closest("[role=alert]")).not.toBeNull()
    expect(told).toBe(0)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("sends the form only once while the first try is still on its way", async () => {
    let calls = 0
    renderForm(() => Effect.andThen(Effect.sync(() => calls++), Effect.never))

    fillAndSubmit("student@oregonstate.edu", "1234")
    const button = screen.getByRole("button", { name: "Continue" })
    await expect.poll(() => button.getAttribute("aria-busy")).toBe("true")
    // Busy, but still a button the keyboard can stay on.
    expect(button.hasAttribute("disabled")).toBe(false)
    button.focus()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    fireEvent.click(button)
    expect(calls).toBe(1)
  })

  it("starts with the email it is given, and the keyboard in the PIN field", () => {
    renderForm(() => Effect.void, { email: "student@oregonstate.edu", autoFocus: true })
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("student@oregonstate.edu")
    expect(document.activeElement).toBe(screen.getByLabelText("4-digit PIN"))
  })

  it("puts the keyboard in the email field when it knows no email", () => {
    renderForm(() => Effect.void, { autoFocus: true })
    expect(document.activeElement).toBe(screen.getByLabelText("Email"))
  })

  it("only lets digits into the PIN field", () => {
    renderForm(() => Effect.void)
    const pin = screen.getByLabelText("4-digit PIN") as HTMLInputElement
    fireEvent.change(pin, { target: { value: "1a 2b" } })
    expect(pin.value).toBe("12")
  })

  it("explains what the PIN is for", () => {
    renderForm(() => Effect.void)
    expect(screen.getByText(/Protects your alerts/)).toBeDefined()
  })
})
