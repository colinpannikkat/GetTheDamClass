// A frame showing an extension page is closed to the class page's scripts, so the email, code and
// token stay here. Only the frame can tell its own sign-in from one made elsewhere.
import { useEffect, useRef, useState } from "react"
import { SignInForm } from "@/components/SignInForm"
import { useAccount } from "@/lib/react"
import { CLASS_SEARCH_ORIGIN, type FrameMessage } from "./messages"

const tellClassPage = (message: FrameMessage) => window.parent.postMessage(message, CLASS_SEARCH_ORIGIN)

export function SignInFrame() {
  const account = useAccount()
  const contentRef = useRef<HTMLDivElement>(null)
  // While the form trades a code, a sign-in in storage is taken as its own (the storage change can
  // arrive first). If the attempt fails, the effect below runs again and asks to be closed.
  const [signingInHere, setSigningInHere] = useState(false)
  const signedIn = account.status === "signedIn"

  useEffect(() => {
    if (signedIn && !signingInHere) {
      tellClassPage({ type: "getthedamclass/close" })
    }
  }, [signedIn, signingInHere])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tellClassPage({ type: "getthedamclass/close" })
      }
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [])

  const loaded = account.status !== "loading"
  useEffect(() => {
    const content = contentRef.current
    if (content === null) {
      return
    }
    const observer = new ResizeObserver(() =>
      tellClassPage({ type: "getthedamclass/resize", height: content.offsetHeight })
    )
    observer.observe(content)
    return () => observer.disconnect()
  }, [loaded])

  if (!loaded) {
    return null
  }
  return (
    <div ref={contentRef} className="p-1">
      <SignInForm
        autoFocus
        email={account.status === "failure" ? undefined : account.email}
        codeRequest={account.status === "failure" ? undefined : account.codeRequest}
        onSigningIn={setSigningInHere}
        onSignedIn={() => tellClassPage({ type: "getthedamclass/signed-in" })}
      />
    </div>
  )
}
