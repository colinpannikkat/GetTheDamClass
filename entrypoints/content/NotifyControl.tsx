/**
 * The "Notify me" control shown in the foot of a class-details panel.
 *
 * What the user sees:
 *
 *   [Notify me]      press it
 *   [◌ Notify me]    the request is on its way
 *   [✓ Watching]     done, with a line saying an email will come
 *
 * If the user is not signed in (or the saved sign-in stopped working), a small
 * sign-in popover opens above the button instead, and the alert is set up as
 * soon as they have signed in. Any other failure shows as a message above the
 * button, which can then be pressed again.
 *
 * Nothing here touches the network until the button is pressed.
 */
import { Option } from "effect"
import { type RefObject, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/Button"
import { cx } from "@/components/cx"
import { Message } from "@/components/Message"
import { SignInForm } from "@/components/SignInForm"
import type { AppError, Crn } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { subscribe } from "@/lib/workflows"

export interface NotifyControlProps {
  /**
   * The CRN of the section the panel shows. It is a function, called when the
   * button is pressed, so the alert is always for the section on screen at
   * that moment and never for one the panel showed earlier.
   */
  readonly getCrn: () => Option.Option<Crn>
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

export function NotifyControl({ getCrn }: NotifyControlProps) {
  const { state, run } = useAction(subscribe)
  // Set when the button was pressed but the panel had no CRN to subscribe to.
  const [crnMissing, setCrnMissing] = useState(false)
  // Set when the user closed the sign-in popover without signing in.
  const [popoverDismissed, setPopoverDismissed] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Everything shown is worked out from `state`, the result of the last press.
  const error = state.status === "failure" ? state.error : null
  const loading = state.status === "loading"
  // Being subscribed already is what the user wanted, so it counts as success.
  const watching = state.status === "success" || error?._tag === "AlreadySubscribed"
  const signInReason = error ? signInReasonOf(error) : null
  const popoverOpen = signInReason !== null && !popoverDismissed && !crnMissing

  let note: string | null = null
  let problem: string | null = null
  if (state.status === "success") {
    note = "We'll email you when a seat opens."
  } else if (crnMissing) {
    problem = "Couldn't find this section's CRN on the page. Reload and try again."
  } else if (error?._tag === "AlreadySubscribed") {
    note = errorMessage(error)
  } else if (error && signInReason === null) {
    problem = errorMessage(error)
  }

  /** Ask for alerts for the section on screen. Also runs after signing in. */
  function notify() {
    const crn = getCrn()
    setCrnMissing(Option.isNone(crn))
    setPopoverDismissed(false)
    if (Option.isSome(crn)) {
      void run(crn.value)
    }
  }

  // Keep the keyboard user's place. A button is disabled while it is loading
  // and the popover's fields vanish when it closes; in both cases the browser
  // drops focus to the page. When that has happened, put it on our button.
  const settled = state.status === "success" || state.status === "failure"
  useEffect(() => {
    const focusWasDropped = document.activeElement === null || document.activeElement === document.body
    if (settled && !popoverOpen && focusWasDropped) {
      buttonRef.current?.focus()
    }
  }, [settled, popoverOpen])

  return (
    <div className="ui-root">
      <Message tone="success" className={MESSAGE_ROW}>{note}</Message>
      <Message tone="error" className={MESSAGE_ROW}>{problem}</Message>
      <div
        ref={controlRef}
        className={BUTTON_PLACE}
        onKeyDown={(event) => {
          if (event.key === "Escape" && popoverOpen) {
            event.stopPropagation()
            setPopoverDismissed(true)
          }
        }}
      >
        <Button
          ref={buttonRef}
          loading={loading}
          // Once watching there is nothing left to press. `aria-disabled`
          // (rather than `disabled`) keeps the button focusable, so keyboard
          // and screen-reader users do not lose their place.
          aria-disabled={watching || undefined}
          aria-expanded={popoverOpen || undefined}
          onClick={watching ? undefined : popoverOpen ? () => setPopoverDismissed(true) : notify}
          className={cx(
            LIKE_THE_PAGE_BUTTONS,
            FULL_WIDTH_WHEN_NARROW,
            watching && "cursor-default! text-success! enabled:hover:bg-surface!"
          )}
        >
          {watching ? <CheckIcon /> : !loading && <BellIcon />}
          {watching ? "Watching" : "Notify me"}
        </Button>
        {popoverOpen && (
          <SignInPopover
            reason={signInReason}
            controlRef={controlRef}
            onSignedIn={notify}
            onClose={() => setPopoverDismissed(true)}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign-in popover
// ---------------------------------------------------------------------------

interface SignInPopoverProps {
  readonly reason: SignInReason
  /** The element holding the button and this popover: presses inside it are not "outside". */
  readonly controlRef: RefObject<HTMLElement | null>
  readonly onSignedIn: () => void
  readonly onClose: () => void
}

/**
 * The shared sign-in form in a small box above the button.
 *
 * It opens upwards because the button sits at the very bottom of the window.
 * The page clips nothing in that direction: the panel's scrolling body is a
 * sibling of the foot, not an ancestor, so the box simply lies over it.
 */
function SignInPopover({ reason, controlRef, onSignedIn, onClose }: SignInPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const contextId = useId()

  // Opening moves keyboard focus to the first field.
  useEffect(() => {
    popoverRef.current?.querySelector("input")?.focus()
  }, [])

  // A press anywhere outside the control closes the popover. (Escape is
  // handled by the control, and closing puts focus back on the button.)
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
      ref={popoverRef}
      role="dialog"
      aria-label="Sign in to get alerts"
      aria-describedby={contextId}
      className={cx(
        "absolute bottom-full left-0 z-10 mb-2 flex w-80 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg",
        // Never wider than the window (the foot has 12px of padding each side)
        // and never taller than the room between the page's header and foot.
        "max-h-[calc(100dvh-140px)] max-w-[calc(100vw-24px)] overflow-y-auto"
      )}
    >
      <p id={contextId} className="text-ink">
        {reason === "WrongPin"
          ? "Your saved sign-in no longer works. Sign in again to get alerts."
          : "Sign in to get an email when a seat opens in this class."}
      </p>
      <SignInForm onSignedIn={onSignedIn} />
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
