/**
 * The "Notify me" control shown in the foot of a class-details panel.
 *
 * What the user sees:
 *
 *   [Notify me]                  press it
 *   [◌ Notify me]                the request is on its way
 *   [✓ Watching]  Stop alerts    alerts are on for this class
 *
 * "Watching" is not this control's memory of its last press. It comes from
 * the saved account (`useAccount`), which the popup shares. So it is already
 * there when the user comes back to a class, and it goes back to "Notify me"
 * the moment the alert is stopped in the popup.
 *
 * That saved list can be behind the server: the alert may have been stopped
 * with the link in an email, or in another browser. "Stop alerts" puts that
 * right too, because "it was not on" counts as stopped.
 *
 * If the user is not signed in (or the server no longer accepts the saved
 * sign-in), a small sign-in popover opens above the button, and the alert is
 * set up as soon as they have signed in there. Any other failure shows as a
 * message above the button, which can then be pressed again. When the server
 * refuses an alert (the term's registration is not open, the add deadline has
 * passed, ...) that message is the server's own sentence.
 *
 * Nothing here touches the network until a button is pressed.
 */
import { Option, Schema } from "effect"
import { type RefObject, useEffect, useId, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { Button } from "@/components/Button"
import { cx } from "@/components/cx"
import { Message } from "@/components/Message"
import { type ClassId, sameClass } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAccount, useAction } from "@/lib/react"
import { subscribe, unsubscribe } from "@/lib/workflows"
import { FrameMessage } from "../signin/messages"

export interface NotifyControlProps {
  /**
   * The section this control is for: its term and CRN. The content script
   * makes a new control whenever the panel moves to another section, so
   * everything in here, including a sign-in that is still open, belongs to
   * this one class.
   */
  readonly classId: ClassId
}

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
 * wide or less (see `.button-bar` in its stylesheet). So do we: our row is as
 * wide as the foot then, and the main button takes the room "Stop alerts"
 * leaves.
 */
const FULL_WIDTH_WHEN_NARROW = "max-[853px]:grow"

/**
 * Our buttons float left as one row. That lets the page's own button bar,
 * which is the next element in the foot, share the row and keep ADD TO CART
 * on the right. (`relative` makes this the box the sign-in popover is
 * positioned from.)
 */
const BUTTON_PLACE =
  "relative float-left mr-3.5 flex items-center gap-1 max-[853px]:float-none max-[853px]:mr-0 max-[853px]:mb-3.5"

/**
 * "Stop alerts": as tall as the buttons, but drawn as a text link. The text is
 * dark because the usual muted grey is too faint on the grey foot.
 */
const QUIET_IN_THE_FOOT = "h-[42px]! rounded-none! px-3! text-ink! underline underline-offset-4 focus-visible:outline-ink!"

/** A message is a row of its own above the button, as wide as its text. */
const MESSAGE_ROW = "mb-2 w-fit max-w-full rounded-none!"

/** The control's one action: turn the alerts for a section on or off. */
const setAlerts = (classId: ClassId, on: boolean) => (on ? subscribe(classId) : unsubscribe(classId))

export function NotifyControl({ classId }: NotifyControlProps) {
  const account = useAccount()
  const { state, run } = useAction(setAlerts)
  // What the last press asked for: alerts on ("Notify me") or off ("Stop alerts").
  const [asked, setAsked] = useState(true)
  // Set when the user closed the sign-in popover without signing in.
  const [popoverDismissed, setPopoverDismissed] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const watching = account.status === "signedIn" && account.watching.some((watched) => sameClass(watched, classId))
  const starting = state.status === "loading" && asked
  const stopping = state.status === "loading" && !asked
  // A press asks for `watching` to become `asked`. It is spoken of only while
  // that explains what is on screen: "done" while it is so, "failed" while it
  // is not. (The popup or another tab can change `watching` at any time.)
  // One failure is the other way round: a "Stop alerts" that found the server
  // no longer accepts the sign-in. That signed this browser out, so
  // "Watching" went away although the alert is still on. It is said for as
  // long as this browser stays signed out.
  const confirmed = state.status === "success" && watching === asked
  const failure = state.status === "failure" ? state.error : null
  const stopFoundSignedOut = failure?._tag === "NotSignedIn" && !asked
  const error = failure && (stopFoundSignedOut ? account.status === "signedOut" : watching !== asked) ? failure : null
  const needsSignIn = error?._tag === "NotSignedIn" && asked
  const popoverOpen = needsSignIn && !popoverDismissed

  /** Ask for alerts for this section ("Notify me"), or stop them ("Stop alerts"). */
  async function press(on: boolean) {
    setAsked(on)
    setPopoverDismissed(false)
    const result = await run(classId, on)
    if (!on && result.status === "success") {
      // "Stop alerts" had the keyboard and is about to disappear.
      buttonRef.current?.focus()
    }
  }

  function closePopover() {
    setPopoverDismissed(true)
    // The keyboard was in the popover, which is about to disappear.
    buttonRef.current?.focus()
  }

  /**
   * The form in our popover was used to sign in: carry on with what the user
   * pressed the button for. Only that form does this. A sign-in anywhere else
   * (the toolbar popup, another tab) shows up in `account`, but nobody
   * pressed anything for this class there.
   */
  function continueAfterSignIn() {
    buttonRef.current?.focus()
    void press(true)
  }

  if (account.status === "loading") {
    // A few milliseconds. Showing nothing beats showing "Notify me" and then
    // changing it to "Watching".
    return null
  }
  return (
    <div className="ui-root">
      <Message tone="success" className={MESSAGE_ROW}>
        {confirmed && (asked ? "We'll email you when a seat opens or the class fills up." : "Alerts stopped for this class.")}
      </Message>
      <Message tone="error" className={MESSAGE_ROW}>
        {error && !needsSignIn && errorMessage(error)}
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
          loading={starting}
          // Once watching, this button only says so; "Stop alerts" is next to it.
          aria-disabled={watching || stopping}
          aria-expanded={popoverOpen || undefined}
          onClick={popoverOpen ? closePopover : () => press(true)}
          className={cx(LIKE_THE_PAGE_BUTTONS, FULL_WIDTH_WHEN_NARROW, watching && "text-success!")}
        >
          {watching ? <CheckIcon /> : !starting && <BellIcon />}
          {watching ? "Watching" : "Notify me"}
        </Button>
        {watching && (
          <Button variant="quiet" loading={stopping} onClick={() => press(false)} className={QUIET_IN_THE_FOOT}>
            Stop alerts
          </Button>
        )}
        {popoverOpen && (
          <SignInPopover
            controlRef={controlRef}
            onClose={closePopover}
            onSignedIn={continueAfterSignIn}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign-in popover
// ---------------------------------------------------------------------------

/** The extension's own sign-in page (`entrypoints/signin`), and where it is served from. */
const SIGN_IN_PAGE = browser.runtime.getURL("/signin.html")
const EXTENSION_ORIGIN = new URL(SIGN_IN_PAGE).origin

const decodeFrameMessage = Schema.decodeUnknownOption(FrameMessage)

/** About the height of the form's first step, used until the frame reports its own. */
const FRAME_HEIGHT_AT_FIRST = 160

interface SignInPopoverProps {
  /** The element holding the button and this popover: presses inside it are not "outside". */
  readonly controlRef: RefObject<HTMLElement | null>
  readonly onClose: () => void
  /** The framed form was used to sign in. */
  readonly onSignedIn: () => void
}

/**
 * A small box above the button with the sign-in form in it.
 *
 * The form is not drawn by this script. It is a page of the extension shown
 * in a frame, so that the email and code are typed where the university's page
 * cannot read them (`entrypoints/signin/SignInFrame.tsx` has the details).
 *
 * The box opens upwards because the button sits at the very bottom of the
 * window. The page clips nothing in that direction: the panel's scrolling
 * body is a sibling of the foot, not an ancestor, so the box lies over it.
 */
function SignInPopover({ controlRef, onClose, onSignedIn }: SignInPopoverProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameHeight, setFrameHeight] = useState(FRAME_HEIGHT_AT_FIRST)
  const contextId = useId()

  // What the framed page tells us (see `signin/messages.ts`).
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
      switch (message.value.type) {
        case "getthedamclass/close":
          return onClose()
        case "getthedamclass/signed-in":
          return onSignedIn()
        case "getthedamclass/resize":
          return setFrameHeight(message.value.height)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onClose, onSignedIn])

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
        Sign in to get an email when a seat opens or the class fills up.
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
