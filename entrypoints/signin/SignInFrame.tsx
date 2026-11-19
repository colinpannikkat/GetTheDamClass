/**
 * The sign-in form as the class page shows it: this page of the extension, in
 * an <iframe> inside the "Notify me" popover (`content/NotifyControl.tsx`).
 *
 * Why a frame? Anything drawn straight into the university's page can be read
 * by that page's scripts, key by key. A frame showing a page of the extension
 * is closed to them: the email and PIN are typed here, checked here and saved
 * here, and the class page never sees them. It learns that someone signed in
 * the same way the popup does, from the saved account changing.
 */
import { useEffect, useRef } from "react"
import { SignInForm } from "@/components/SignInForm"
import { useAccount } from "@/lib/react"
import { CLASS_SEARCH_ORIGIN, type FrameMessage } from "./messages"

const tellClassPage = (message: FrameMessage) => window.parent.postMessage(message, CLASS_SEARCH_ORIGIN)

export function SignInFrame() {
  const account = useAccount()
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The class page cannot hear keys pressed in here, so pass Escape on.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tellClassPage({ type: "getthedamclass/close" })
      }
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [])

  // Nor can it measure us. Report the height whenever it changes (an error
  // message appeared), so the frame can be made to fit without scrolling.
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
    return null // A few milliseconds, until we know whether there is an email to fill in.
  }
  return (
    // `p-1` leaves room for the focus rings, which the frame's edge would cut off.
    <div ref={contentRef} className="p-1">
      <SignInForm
        autoFocus
        // Someone whose saved PIN stopped working only has to type the new one.
        email={account.status === "signedIn" ? account.credentials.email : undefined}
      />
    </div>
  )
}
