import { EmailAddress, SignInCode } from "@getthedamclass/shared/domain"
import { Option, Schema } from "effect"
import { type FormEvent, useState } from "react"
import type { CodeRequest } from "@/lib/AccountStore"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { changeEmail, requestCode, signIn } from "@/lib/workflows"
import { Button } from "./Button"
import { Message } from "./Message"
import { TextField } from "./TextField"

export interface SignInFormProps {
  /** The address last used on this browser, to start with. */
  readonly email?: EmailAddress
  /** A code that was asked for and not used yet. The form then starts at the step where it is typed. */
  readonly codeRequest?: CodeRequest
  /** Put the keyboard in the field when the form appears. */
  readonly autoFocus?: boolean
  /** Called after the server accepted the code and the sign-in was saved. */
  readonly onSignedIn?: () => void
}

/**
 * Signing in, in two steps: the email, then the six-digit code the server
 * emails to it. There is no separate "sign up" and nothing to forget: the
 * server creates the account the first time a code for an address is used.
 *
 * Which step shows comes from what is saved (`codeRequest`), not from this
 * component. The browser closes the popup as soon as the student switches to
 * their inbox, so the form must come back at the code step when it is opened
 * again. The framed form on the class page reads the same storage.
 *
 * Only ever render this in a page of the extension itself (the popup, or
 * `entrypoints/signin`), never straight into a website: the scripts of a page
 * can read whatever is typed into that page.
 */
export function SignInForm({ email, codeRequest, autoFocus = false, onSignedIn }: SignInFormProps) {
  // The address the email step starts with. "Use a different email" sets it
  // to the one the code went to, so a typo is quick to fix.
  const [startWith, setStartWith] = useState(email ?? "")
  // Once the student has moved from one step to the other, the keyboard goes
  // to the new step's field.
  const [moved, setMoved] = useState(false)

  return codeRequest === undefined
    ? <EmailStep startWith={startWith} autoFocus={autoFocus || moved} onSubmit={() => setMoved(true)} />
    : (
      <CodeStep
        email={codeRequest.email}
        autoFocus={autoFocus || moved}
        onChangeEmail={() => {
          setStartWith(codeRequest.email)
          setMoved(true)
        }}
        onSignedIn={onSignedIn}
      />
    )
}

// What is typed is checked with the API's own schemas before it is sent: the
// server refuses anything else without a sentence for the student. Decoding
// also tidies it up the way the server expects (spaces trimmed, the email in
// lower case).
const decodeEmail = Schema.decodeUnknownOption(EmailAddress)
const decodeCode = Schema.decodeUnknownOption(SignInCode)

function EmailStep({ startWith, autoFocus, onSubmit }: {
  readonly startWith: string
  readonly autoFocus: boolean
  /** The student asked for a code: the code step comes next. */
  readonly onSubmit: () => void
}) {
  const [typed, setTyped] = useState(startWith)
  const [error, setError] = useState<string | null>(null)
  const request = useAction(requestCode)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = decodeEmail(typed)
    if (Option.isNone(email)) {
      return setError("Enter your whole email address, like you@example.com.")
    }
    setError(null)
    onSubmit()
    const result = await request.run(email.value)
    // On success the code step takes this one's place. So it does after
    // "a code went to this address less than a minute ago": that code is
    // waiting in the inbox (see `requestCode`).
    if (result.status === "failure" && result.error._tag !== "CodeRecentlySent") {
      setError(errorMessage(result.error))
    }
  }

  return (
    // `noValidate`: the browser's own checks would show its own bubbles and
    // words. The schemas above check instead, and the sentence shows below.
    <form noValidate onSubmit={handleSubmit} className="ui-root flex flex-col gap-3">
      <TextField
        label="Email"
        hint="We'll email you a code. No password, and no separate sign-up."
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@example.com"
        autoFocus={autoFocus}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <Message tone="error">{error}</Message>
      <Button type="submit" variant="primary" loading={request.state.status === "loading"}>
        Email me a code
      </Button>
    </form>
  )
}

/** `useAction` wants a function; `changeEmail` is an effect that takes no arguments. */
const runChangeEmail = () => changeEmail

function CodeStep({ email, autoFocus, onChangeEmail, onSignedIn }: {
  /** Where the code was sent. */
  readonly email: EmailAddress
  readonly autoFocus: boolean
  /** The student is going back to the email step. */
  readonly onChangeEmail: () => void
  readonly onSignedIn?: () => void
}) {
  const [typed, setTyped] = useState("")
  // What the last thing the student did here came to. One at a time, so an
  // old failure never shows next to a newer answer.
  const [notice, setNotice] = useState<{ readonly tone: "error" | "success"; readonly text: string } | null>(null)
  const signInAction = useAction(signIn)
  const resend = useAction(requestCode)
  const goBack = useAction(runChangeEmail)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = decodeCode(typed)
    if (Option.isNone(code)) {
      return setNotice({ tone: "error", text: "Enter the 6 digits from the email." })
    }
    setNotice(null)
    const result = await signInAction.run(email, code.value)
    if (result.status === "success") {
      onSignedIn?.()
    } else {
      setNotice({ tone: "error", text: errorMessage(result.error) })
    }
  }

  async function handleResend() {
    setNotice(null)
    const result = await resend.run(email)
    setNotice(
      result.status === "success"
        ? { tone: "success", text: `We sent a new code to ${email}.` }
        : { tone: "error", text: errorMessage(result.error) }
    )
  }

  async function handleChangeEmail() {
    onChangeEmail()
    const result = await goBack.run()
    if (result.status === "failure") {
      setNotice({ tone: "error", text: errorMessage(result.error) })
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="ui-root flex flex-col gap-3">
      <TextField
        label="6-digit code"
        hint={`We sent it to ${email}. It works for 15 minutes.`}
        // Text rather than `type="number"`: a code can start with 0, and a
        // number field would offer arrows to count it up and down.
        type="text"
        name="code"
        // A phone shows its number pad, and the browser may offer the code
        // from the email or a text message ("one-time-code").
        inputMode="numeric"
        autoComplete="one-time-code"
        className="tracking-widest"
        autoFocus={autoFocus}
        value={typed}
        // Keep digits only, so a stray space or letter cannot be typed, and a
        // pasted "123 456" becomes "123456".
        onChange={(event) => setTyped(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <Message tone="error">{notice?.tone === "error" ? notice.text : null}</Message>
      <Message tone="success">{notice?.tone === "success" ? notice.text : null}</Message>
      <Button type="submit" variant="primary" loading={signInAction.state.status === "loading"}>
        Sign in
      </Button>
      <div className="flex flex-wrap justify-center gap-1">
        <Button variant="quiet" size="sm" loading={resend.state.status === "loading"} onClick={handleResend}>
          Send a new code
        </Button>
        <Button variant="quiet" size="sm" onClick={handleChangeEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  )
}
