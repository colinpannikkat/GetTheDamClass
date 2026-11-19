import { type FormEvent, useState } from "react"
import type { SignInOutcome } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { signIn } from "@/lib/workflows"
import { Button } from "./Button"
import { cx } from "./cx"
import { Message } from "./Message"
import { TextField } from "./TextField"

export interface SignInFormProps {
  /**
   * Called after the server accepted the email and PIN and they were saved.
   * `outcome` says whether a new account was created.
   */
  readonly onSignedIn?: (outcome: SignInOutcome) => void
  readonly className?: string
}

/**
 * Email and PIN in one form. There is no separate "sign up": the backend
 * creates the account the first time it sees an email.
 */
export function SignInForm({ onSignedIn, className }: SignInFormProps) {
  const [email, setEmail] = useState("")
  const [pin, setPin] = useState("")
  const { state, run } = useAction(signIn)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await run({ email: email.trim(), pin })
    if (result.status === "success") {
      onSignedIn?.(result.value)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cx("ui-root flex flex-col gap-3", className)}>
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@oregonstate.edu"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="4-digit PIN"
        hint="Protects your alerts. New here? Pick any 4 digits."
        // A text input drawn as dots, not `type="password"`: a password field
        // makes the browser offer to save the PIN as the password for whatever
        // site the form is shown on (the university's).
        type="text"
        className="[-webkit-text-security:disc]"
        name="pin"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4}"
        maxLength={4}
        title="Exactly 4 digits"
        required
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
