import { type FormEvent, useState } from "react"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { signIn } from "@/lib/workflows"
import { Button } from "./Button"
import { Message } from "./Message"
import { TextField } from "./TextField"

export interface SignInFormProps {
  /** An email to start with, when we know who is signing in again. */
  readonly email?: string
  /** Put the keyboard in the first empty field when the form appears. */
  readonly autoFocus?: boolean
  /** Called after the server accepted the email and PIN and they were saved. */
  readonly onSignedIn?: () => void
}

/**
 * Email and PIN in one form. There is no separate "sign up": the backend
 * creates the account the first time it sees an email.
 *
 * Only ever render this in a page of the extension itself (the popup, or
 * `entrypoints/signin`), never straight into a website: the scripts of a page
 * can read whatever is typed into that page.
 */
export function SignInForm({ email: knownEmail = "", autoFocus = false, onSignedIn }: SignInFormProps) {
  const [email, setEmail] = useState(knownEmail)
  const [pin, setPin] = useState("")
  const { state, run } = useAction(signIn)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await run({ email: email.trim(), pin })
    if (result.status === "success") {
      onSignedIn?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ui-root flex flex-col gap-3">
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        autoFocus={autoFocus && knownEmail === ""}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="4-digit PIN"
        hint="Protects your alerts. New here? Pick any 4 digits."
        // A text input drawn as dots, not `type="password"`: a password field
        // makes the browser offer to save the PIN as a password.
        type="text"
        className="[-webkit-text-security:disc]"
        name="pin"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4}"
        maxLength={4}
        title="Exactly 4 digits"
        required
        autoFocus={autoFocus && knownEmail !== ""}
        value={pin}
        // Keep digits only, so a stray space or letter cannot be typed.
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
      />
      <Message tone="error">{state.status === "failure" ? errorMessage(state.error) : null}</Message>
      <Button type="submit" variant="primary" loading={state.status === "loading"}>
        Continue
      </Button>
    </form>
  )
}
