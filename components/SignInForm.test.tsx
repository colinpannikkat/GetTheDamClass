// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { Api } from "@/lib/Api"
import { CredentialStore } from "@/lib/CredentialStore"
import { type Credentials, type SignInOutcome, WrongPin } from "@/lib/domain"
import { RuntimeContext } from "@/lib/react"
import { SignInForm } from "./SignInForm"

/** Render the form with a fake Api. Storage is WXT's in-memory `browser`. */
function renderForm(
  signIn: Api["Service"]["signIn"],
  onSignedIn?: (outcome: SignInOutcome) => void
) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(Layer.mock(Api, { signIn }), CredentialStore.layer))
  return render(
    <RuntimeContext value={runtime}>
      <SignInForm onSignedIn={onSignedIn} />
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
    const outcomes: Array<SignInOutcome> = []
    renderForm(
      (credentials) => Effect.sync(() => (sent.push(credentials), "accountCreated" as const)),
      (outcome) => outcomes.push(outcome)
    )

    fillAndSubmit("  student@oregonstate.edu ", "1234")

    await expect.poll(() => outcomes).toEqual(["accountCreated"])
    expect(sent).toEqual([{ email: "student@oregonstate.edu", pin: "1234" }])
    expect(await fakeBrowser.storage.local.get()).toEqual({ email: "student@oregonstate.edu", pin: "1234" })
  })

  it("shows a wrong PIN as an inline alert and saves nothing", async () => {
    const outcomes: Array<SignInOutcome> = []
    renderForm(
      () => Effect.fail(new WrongPin({ message: "Wrong pin. Try again!" })),
      (outcome) => outcomes.push(outcome)
    )

    fillAndSubmit("student@oregonstate.edu", "9999")

    const message = await screen.findByText(/PIN doesn't match/)
    expect(message.closest("[role=alert]")).not.toBeNull()
    expect(outcomes).toEqual([])
    expect(await fakeBrowser.storage.local.get()).toEqual({})
  })

  it("only lets digits into the PIN field", () => {
    renderForm(() => Effect.succeed("loggedIn"))
    const pin = screen.getByLabelText("4-digit PIN") as HTMLInputElement
    fireEvent.change(pin, { target: { value: "1a 2b" } })
    expect(pin.value).toBe("12")
  })

  it("explains what the PIN is for", () => {
    renderForm(() => Effect.succeed("loggedIn"))
    expect(screen.getByText(/Protects your alerts/)).toBeDefined()
  })
})
