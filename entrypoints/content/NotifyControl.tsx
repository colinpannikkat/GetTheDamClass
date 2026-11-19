/**
 * The "Notify me" control shown in the foot of a class-details panel.
 *
 * What the user sees:
 *
 *   [Notify me]      press it
 *   [◌ Notify me]    the request is on its way
 *   [✓ Watching]     alerts are on for this class
 *
 * "Watching" is not this control's memory of its last press. It comes from
 * the saved account (`useAccount`), which the popup shares. So it is already
 * there when the user comes back to a class, and it goes back to "Notify me"
 * the moment the alert is stopped in the popup.
 *
 * If the user is not signed in (or the saved sign-in stopped working), a small
 * sign-in popover opens above the button, and the alert is set up as soon as
 * they have signed in. Any other failure shows as a message above the button,
 * which can then be pressed again.
 *
 * Nothing here touches the network until the button is pressed.
 */
import { Option, Schema } from "effect"
import { type RefObject, useEffect, useId, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { Button } from "@/components/Button"
import { cx } from "@/components/cx"
import { Message } from "@/components/Message"
import type { AppError, Crn } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAccount, useAction } from "@/lib/react"
import { SUPPORTED_TERM } from "@/lib/term"
import { subscribe } from "@/lib/workflows"
import { FrameMessage } from "../signin/messages"

export interface NotifyControlProps {
  /**
   * The section this control is for. The content script makes a new control
   * whenever the panel moves to another section, so everything in here,
   * including a sign-in that is still open, belongs to this one CRN.
   */
  readonly crn: Crn
}

/** The two errors that are answered with the sign-in popover. */
type SignInReason = "NotSignedIn" | "WrongPin"

const signInReasonOf = (error: AppError): SignInReason | null =>
  error._tag === "NotSignedIn" || error._tag === "WrongPin" ? error._tag : null

// ---------------------------------------------------------------------------
// Fitting into the page
//
// The control sits in the grey foot of the details panel, to the left of the
// page's own ADD TO CART. The class lists below end in `!` ("important") where
// they replace a default of the shared Button or Message rather than add to it.
// ---------------------------------------------------------------------------

/**
 * Same size and shape as the page's own buttons: 42px tall, square, bold. The
 * focus ring is dark because the usual orange one is hard to see on grey.
 */
const LIKE_THE_PAGE_BUTTONS = "h-[42px]! rounded-none! px-5! font-bold! focus-visible:outline-ink!"

/**
 * The page puts its buttons in one full-width column when the window is 853px
 * wide or less (see `.button-bar` in its stylesheet). So do we.
 */
const FULL_WIDTH_WHEN_NARROW = "max-[853px]:w-full"

/**
 * The button floats left. That lets the page's own button bar, which is the
 * next element in the foot, share the row and keep ADD TO CART on the right.
 * (`relative` makes this the box the sign-in popover is positioned from.)
 */
const BUTTON_PLACE = "relative float-left mr-3.5 max-[853px]:float-none max-[853px]:mr-0 max-[853px]:mb-3.5"

/** A message is a row of its own above the button, as wide as its text. */
const MESSAGE_ROW = "mb-2 w-fit max-w-full rounded-none!"

export function NotifyControl({ crn }: NotifyControlProps) {
  const account = useAccount()
  const { state, run } = useAction(subscribe)
  // Set when the user closed the sign-in popover without signing in.
  const [popoverDismissed, setPopoverDismissed] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const watching = account.status === "signedIn" && account.watching.includes(crn)
  const loading = state.status === "loading"
  // What the last press came to. It stops mattering once the class is watched.
  const error = state.status === "failure" && !watching ? state.error : null
  const signInReason = error ? signInReasonOf(error) : null
  const popoverOpen = signInReason !== null && !popoverDismissed

  /** Ask for alerts for this section. Also runs after signing in. */
  function notify() {
    setPopoverDismissed(false)
    void run(crn)
  }

  function closePopover() {
    setPopoverDismissed(true)
    // The keyboard was in the popover, which is about to disappear.
    buttonRef.current?.focus()
  }

  // The sign-in form is in a frame that we cannot look into (see
  // SignInPopover). We learn that the user signed in the way the popup does:
  // the saved account changes. If that happens while the popover is open,
  // carry on with what they pressed the button for.
  const savedSignIn = account.status === "signedIn" ? `${account.credentials.email} ${account.credentials.pin}` : null
  useEffect(() => {
    if (popoverOpen && savedSignIn !== null) {
      buttonRef.current?.focus()
      notify()
    }
    // Only a change of the saved sign-in runs this, not the popover opening.
  }, [savedSignIn])

  if (account.status === "loading") {
    // A few milliseconds. Showing nothing beats showing "Notify me" and then
    // changing it to "Watching".
    return null
  }
  return (
    <div className="ui-root">
      <Message tone="success" className={MESSAGE_ROW}>
        {watching && state.status === "success" ? "We'll email you when a seat opens." : null}
      </Message>
      <Message tone="error" className={MESSAGE_ROW}>
        {error && signInReason === null ? errorMessage(error) : null}
      </Message>
      <div
        ref={controlRef}
        className={BUTTON_PLACE}
        onKeyDown={(event) => {
          if (event.key === "Escape" && popoverOpen) {
            event.stopPropagation()
            closePopover()
          }
        }}
      >
        <Button
          ref={buttonRef}
          loading={loading}
          // Once watching there is nothing left to press here; stopping is
          // done in the popup.
          aria-disabled={watching}
          aria-expanded={popoverOpen || undefined}
          onClick={popoverOpen ? closePopover : notify}
          className={cx(LIKE_THE_PAGE_BUTTONS, FULL_WIDTH_WHEN_NARROW, watching && "text-success!")}
        >
          {watching ? <CheckIcon /> : !loading && <BellIcon />}
          {watching ? "Watching" : "Notify me"}
        </Button>
        {popoverOpen && <SignInPopover reason={signInReason} controlRef={controlRef} onClose={closePopover} />}
      </div>
    </div>
  )
}

/**
 * Shown where the button would be, on a section of a term the backend does
 * not watch (see `lib/term.ts`). As tall as the button, so the foot keeps its
 * shape.
 */
export function OtherTermNote() {
  return (
    <p className={cx("ui-root flex min-h-[42px] items-center", BUTTON_PLACE)}>
      Seat alerts cover {SUPPORTED_TERM.label} classes only.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Sign-in popover
// ---------------------------------------------------------------------------

/** The extension's own sign-in page (`entrypoints/signin`), and where it is served from. */
const SIGN_IN_PAGE = browser.runtime.getURL("/signin.html")
const EXTENSION_ORIGIN = new URL(SIGN_IN_PAGE).origin

const decodeFrameMessage = Schema.decodeUnknownOption(FrameMessage)

/** The height of the form with no error showing, used until the frame reports its own. */
const FRAME_HEIGHT_AT_FIRST = 220

interface SignInPopoverProps {
  readonly reason: SignInReason
  /** The element holding the button and this popover: presses inside it are not "outside". */
  readonly controlRef: RefObject<HTMLElement | null>
  readonly onClose: () => void
}

/**
 * A small box above the button with the sign-in form in it.
 *
 * The form is not drawn by this script. It is a page of the extension shown
 * in a frame, so that the email and PIN are typed where the university's page
 * cannot read them (`entrypoints/signin/SignInFrame.tsx` has the details).
 *
 * The box opens upwards because the button sits at the very bottom of the
 * window. The page clips nothing in that direction: the panel's scrolling
 * body is a sibling of the foot, not an ancestor, so the box lies over it.
 */
function SignInPopover({ reason, controlRef, onClose }: SignInPopoverProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameHeight, setFrameHeight] = useState(FRAME_HEIGHT_AT_FIRST)
  const contextId = useId()

  // The two things the framed page tells us (see `signin/messages.ts`).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Any page or frame can post a message to this window. Only our own
      // page, in our own frame, is listened to.
      if (event.source !== frameRef.current?.contentWindow || event.origin !== EXTENSION_ORIGIN) {
        return
      }
      const message = decodeFrameMessage(event.data)
      if (Option.isNone(message)) {
        return
      }
      if (message.value.type === "getthedamclass/close") {
        onClose()
      } else {
        setFrameHeight(message.value.height)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onClose])

  // A press anywhere outside the control closes the popover. (A press inside
  // the frame never reaches this document, so it cannot count as outside.)
  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
      // `composedPath` lists every element the press passed through,
      // including the ones inside our shadow root, which `event.target` hides.
      if (controlRef.current && !event.composedPath().includes(controlRef.current)) {
        onClose()
      }
    }
    // `true`: hear the press on its way down, before the page can swallow it.
    document.addEventListener("pointerdown", closeIfOutside, true)
    return () => document.removeEventListener("pointerdown", closeIfOutside, true)
  }, [controlRef, onClose])

  return (
    <div
      role="dialog"
      aria-label="Sign in to get alerts"
      aria-describedby={contextId}
      className={cx(
        // 12px of padding here plus 4px inside the frame: 16px around the form.
        "absolute bottom-full left-0 z-10 mb-2 flex w-80 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg",
        // Never wider than the window (the foot has 12px of padding each side)
        // and never taller than the room between the page's header and foot.
        "max-h-[calc(100dvh-140px)] max-w-[calc(100vw-24px)] overflow-y-auto"
      )}
    >
      <p id={contextId} className="px-1 pt-1">
        {reason === "WrongPin"
          ? "Your saved PIN no longer works. Sign in again to get alerts."
          : "Sign in to get an email when a seat opens in this class."}
      </p>
      <iframe
        ref={frameRef}
        src={SIGN_IN_PAGE}
        title="Sign in"
        className="w-full shrink-0 border-0"
        style={{ height: frameHeight }}
        // Hand the keyboard to the frame; its page puts it in the right field.
        onLoad={() => frameRef.current?.focus()}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function BellIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" strokeLinejoin="round" />
      <path d="M10 19.5a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
