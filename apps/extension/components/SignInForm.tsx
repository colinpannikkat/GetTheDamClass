/**
 * The sign-in form, in two steps: the email, then the six-digit code the
 * server emails to it. There is no separate "sign up" and nothing to forget:
 * the server creates the account the first time a code for an address is
 * used. The popup shows it, and so does the class page, in a frame
 * (`entrypoints/signin`).
 *
 * Which step shows comes from what is saved (`codeRequest` in
 * `lib/AccountStore.ts`), not from this component. The browser closes the
 * popup as soon as the student switches to their inbox, so the form must come
 * back at the code step when it is opened again. Every form reads the same
 * storage, so a code asked for in the popup can be typed in the frame on the
 * class page, and the other way round.
 *
 * Only ever render this in a page of the extension itself (the popup, or
 * `entrypoints/signin`), never straight into a website: the scripts of a page
 * can read whatever is typed into that page.
 */
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
  /** A code that was asked for and not used yet. The form then shows the step where it is typed. */
  readonly codeRequest?: CodeRequest
  /**
   * Put the keyboard in the email field when the form appears. (The code
   * step always takes the keyboard: whoever sees it has come to type a code.)
   */
  readonly autoFocus?: boolean
  /**
   * Called with `true` as the code is sent to the server to sign in, and with
   * `false` if that did not sign in. In between, a sign-in that shows up in
   * storage is this form's own.
   */
  readonly onSigningIn?: (signingIn: boolean) => void
  /** Called after the server accepted the code and the sign-in was saved. */
  readonly onSignedIn?: () => void
}

/**
 * A sentence under the form about the last thing the student did, and the
 * step it is about: the code step for this address, or the email step
 * (`undefined`).
 */
interface Notice {
  readonly step: EmailAddress | undefined
  readonly tone: "error" | "success"
  readonly text: string
}

// What is typed is checked with the API's own schemas before it is sent: the
// server refuses anything else without a sentence for the student. Decoding
// also tidies it up the way the server expects (spaces trimmed, the email in
// lower case).
const decodeEmail = Schema.decodeUnknownOption(EmailAddress)
const decodeCode = Schema.decodeUnknownOption(SignInCode)

export function SignInForm({ email, codeRequest, autoFocus = false, onSigningIn, onSignedIn }: SignInFormProps) {
  const step = codeRequest?.email
  // The address the email step starts with: the last one used here, and then
  // the one a code was last asked for, so a typo is quick to fix after "Use a
  // different email". (Setting state while rendering is React's way to follow
  // a prop; React renders again straight away.)
  const [startWith, setStartWith] = useState(email ?? "")
  if (step !== undefined && step !== startWith) {
    setStartWith(step)
  }
  // Once the student has used the form, the keyboard follows it to the email
  // step when it goes back there. (The code step always takes it.)
  const [moved, setMoved] = useState(false)
  // One sentence at a time, so an old failure never shows next to a newer
  // answer. It shows only on the step it is about: when another part of the
  // extension asks for a code for another address, what was said here about
  // the old one goes away.
  const [notice, setNotice] = useState<Notice | null>(null)
  const shownNotice = notice?.step === step ? notice : null
  // Both steps ask for codes: the email step its first, the code step a new one.
  const request = useAction(requestCode)
  const sending = request.state.status === "loading"

  async function askForCode(to: EmailAddress) {
    const stepBefore = step
    setNotice(null)
    const result = await request.run(to)
    if (result.status === "success") {
      if (stepBefore === to) {
        setNotice({ step: to, tone: "success", text: `We sent a new code to ${to}.` })
      }
      return
    }
    // A failure takes the form back to where it was (see `requestCode`),
    // except "a code went to this address less than a minute ago", which
    // leaves it at that address's code step. Say why on that step.
    setNotice({
      step: result.error._tag === "CodeRecentlySent" ? to : stepBefore,
      tone: "error",
      text: errorMessage(result.error)
    })
  }

  function submitEmail(typed: string) {
    const decoded = decodeEmail(typed)
    if (Option.isNone(decoded)) {
      return setNotice({ step: undefined, tone: "error", text: "Enter your whole email address, like you@example.com." })
    }
    setMoved(true)
    void askForCode(decoded.value)
  }

  return codeRequest === undefined
    ? (
      <EmailStep
        startWith={startWith}
        autoFocus={autoFocus || moved}
        notice={shownNotice}
        sending={sending}
        onSubmit={submitEmail}
      />
    )
    : (
      <CodeStep
        // A new address is a new code step: nothing typed for the old one stays.
        key={codeRequest.email}
        email={codeRequest.email}
        notice={shownNotice}
        sending={sending}
        onNotice={(tone, text) => setNotice({ step: codeRequest.email, tone, text })}
        onResend={() => void askForCode(codeRequest.email)}
        onChangeEmail={() => setMoved(true)}
        onSigningIn={onSigningIn}
        onSignedIn={onSignedIn}
      />
    )
}

function EmailStep({ startWith, autoFocus, notice, sending, onSubmit }: {
  readonly startWith: string
  readonly autoFocus: boolean
  readonly notice: Notice | null
  /** A code is being asked for. */
  readonly sending: boolean
  readonly onSubmit: (typed: string) => void
}) {
  const [typed, setTyped] = useState(startWith)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(typed)
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
      <Message tone="error">{notice?.tone === "error" ? notice.text : null}</Message>
      <Button type="submit" variant="primary" loading={sending}>
        Email me a code
      </Button>
    </form>
  )
}

function CodeStep({ email, notice, sending, onNotice, onResend, onChangeEmail, onSigningIn, onSignedIn }: {
  /** Where the code was sent. */
  readonly email: EmailAddress
  readonly notice: Notice | null
  /** A code is being asked for: the first one, or a new one. */
  readonly sending: boolean
  readonly onNotice: (tone: Notice["tone"], text: string) => void
  /** "Send a new code" was pressed. */
  readonly onResend: () => void
  /** The student is going back to the email step. */
  readonly onChangeEmail: () => void
  readonly onSigningIn?: (signingIn: boolean) => void
  readonly onSignedIn?: () => void
}) {
  const [typed, setTyped] = useState("")
  const signInAction = useAction(signIn)
  const goBack = useAction(changeEmail)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = decodeCode(typed)
    if (Option.isNone(code)) {
      return onNotice("error", "Enter the 6 digits from the email.")
    }
    onSigningIn?.(true)
    const result = await signInAction.run(email, code.value)
    if (result.status === "success") {
      onSignedIn?.()
    } else {
      onSigningIn?.(false)
      onNotice("error", errorMessage(result.error))
    }
  }

  async function handleChangeEmail() {
    onChangeEmail()
    const result = await goBack.run()
    if (result.status === "failure") {
      onNotice("error", errorMessage(result.error))
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="ui-root flex flex-col gap-3">
      <TextField
        label="6-digit code"
        hint={sending ? `Sending a code to ${email}…` : `We sent it to ${email}. It works for 15 minutes.`}
        // Text rather than `type="number"`: a code can start with 0, and a
        // number field would offer arrows to count it up and down.
        type="text"
        name="code"
        // A phone shows its number pad, and the browser may offer the code
        // from the email or a text message ("one-time-code").
        inputMode="numeric"
        autoComplete="one-time-code"
        className="tracking-widest"
        autoFocus
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
        <Button variant="quiet" size="sm" loading={sending} onClick={onResend}>
          Send a new code
        </Button>
        <Button variant="quiet" size="sm" onClick={handleChangeEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  )
}
