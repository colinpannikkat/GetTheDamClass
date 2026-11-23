// Only render this in a page of the extension, never straight into a website: the website's scripts
// can read whatever is typed into it.
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
  readonly email?: EmailAddress
  readonly codeRequest?: CodeRequest
  readonly autoFocus?: boolean
  readonly onSigningIn?: (signingIn: boolean) => void
  readonly onSignedIn?: () => void
}

interface Notice {
  readonly codeStepFor: EmailAddress | undefined
  readonly tone: "error" | "success"
  readonly text: string
}

const decodeEmail = Schema.decodeUnknownOption(EmailAddress)
const decodeCode = Schema.decodeUnknownOption(SignInCode)

export function SignInForm({ email, codeRequest, autoFocus = false, onSigningIn, onSignedIn }: SignInFormProps) {
  const codeStepFor = codeRequest?.email
  const [startWith, setStartWith] = useState(email ?? "")
  if (codeStepFor !== undefined && codeStepFor !== startWith) {
    setStartWith(codeStepFor)
  }
  const [moved, setMoved] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const shownNotice = notice?.codeStepFor === codeStepFor ? notice : null
  const request = useAction(requestCode)
  const sending = request.state.status === "loading"

  async function askForCode(to: EmailAddress): Promise<boolean> {
    const codeStepBefore = codeStepFor
    setNotice(null)
    const result = await request.run(to)
    if (result.status === "success") {
      if (codeStepBefore === to) {
        setNotice({ codeStepFor: to, tone: "success", text: `We sent a new code to ${to}.` })
      }
      return true
    }
    const { error } = result
    if (error._tag === "CodeNotSent") {
      setNotice({ codeStepFor: error.codeStepFor, tone: "error", text: errorMessage(error.reason) })
    } else if (error._tag !== "CodeRequestOvertaken") {
      setNotice({ codeStepFor: codeStepBefore, tone: "error", text: errorMessage(error) })
    }
    return false
  }

  function submitEmail(typed: string) {
    const decoded = decodeEmail(typed)
    if (Option.isNone(decoded)) {
      return setNotice({
        codeStepFor: undefined,
        tone: "error",
        text: "Enter your whole email address, like you@example.com."
      })
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
        key={codeRequest.email}
        email={codeRequest.email}
        notice={shownNotice}
        sending={sending}
        onNotice={(tone, text) => setNotice({ codeStepFor: codeRequest.email, tone, text })}
        onResend={() => askForCode(codeRequest.email)}
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
  readonly sending: boolean
  readonly onSubmit: (typed: string) => void
}) {
  const [typed, setTyped] = useState(startWith)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(typed)
  }

  return (
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
  readonly email: EmailAddress
  readonly notice: Notice | null
  readonly sending: boolean
  readonly onNotice: (tone: Notice["tone"], text: string) => void
  readonly onResend: () => Promise<boolean>
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

  async function handleResend() {
    if (await onResend()) {
      setTyped("")
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
        // "Check", not "we sent it": the request is saved before the server answers.
        hint={sending ? `Sending a code to ${email}…` : `Check ${email} for the code. It works for 15 minutes.`}
        // Text, not `type="number"`: a code can start with 0.
        type="text"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="tracking-widest"
        autoFocus
        value={typed}
        onChange={(event) => setTyped(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <Message tone="error">{notice?.tone === "error" ? notice.text : null}</Message>
      <Message tone="success">{notice?.tone === "success" ? notice.text : null}</Message>
      <Button type="submit" variant="primary" loading={signInAction.state.status === "loading"}>
        Sign in
      </Button>
      <div className="flex flex-wrap justify-center gap-1">
        <Button variant="quiet" size="sm" loading={sending} onClick={() => void handleResend()}>
          Send a new code
        </Button>
        <Button variant="quiet" size="sm" onClick={handleChangeEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  )
}
