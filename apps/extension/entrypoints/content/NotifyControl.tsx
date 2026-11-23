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
  readonly classId: ClassId
}

// Class lists ending in `!` replace a default of the shared Button or Message rather than add to it.

const LIKE_THE_PAGE_BUTTONS = "h-[42px]! rounded-none! px-5! font-bold! focus-visible:outline-ink!"

// The page stacks its buttons in one column at 853px wide or less (`.button-bar`), so we do too.
const FULL_WIDTH_WHEN_NARROW = "max-[853px]:grow"

const BUTTON_PLACE =
  "relative float-left mr-3.5 flex items-center gap-1 max-[853px]:float-none max-[853px]:mr-0 max-[853px]:mb-3.5"

const QUIET_IN_THE_FOOT = "h-[42px]! rounded-none! px-3! text-ink! underline underline-offset-4 focus-visible:outline-ink!"

const MESSAGE_ROW = "mb-2 w-fit max-w-full rounded-none!"

const setAlerts = (classId: ClassId, on: boolean) => (on ? subscribe(classId) : unsubscribe(classId))

export function NotifyControl({ classId }: NotifyControlProps) {
  const account = useAccount()
  const { state, run } = useAction(setAlerts)
  const [asked, setAsked] = useState(true)
  const [popoverDismissed, setPopoverDismissed] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const watching = account.status === "signedIn" && account.watching.some((watched) => sameClass(watched, classId))
  const starting = state.status === "loading" && asked
  const stopping = state.status === "loading" && !asked
  const confirmed = state.status === "success" && watching === asked
  const failure = state.status === "failure" ? state.error : null
  // A "Stop alerts" that found the sign-in rejected signed this browser out, so "Watching" went
  // away although the alert is still on.
  const stopFoundSignedOut = failure?._tag === "NotSignedIn" && !asked
  const failureStillShows = stopFoundSignedOut ? account.status === "signedOut" : watching !== asked
  const error = failureStillShows ? failure : null
  const needsSignIn = error?._tag === "NotSignedIn" && asked
  const popoverOpen = needsSignIn && !popoverDismissed

  async function press(on: boolean) {
    setAsked(on)
    setPopoverDismissed(false)
    const result = await run(classId, on)
    if (!on && result.status === "success") {
      buttonRef.current?.focus()
    }
  }

  function closePopover() {
    setPopoverDismissed(true)
    buttonRef.current?.focus()
  }

  // Only our own form does this; after a sign-in elsewhere the frame asks to be closed instead.
  function continueAfterSignIn() {
    buttonRef.current?.focus()
    void press(true)
  }

  if (account.status === "loading") {
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

const SIGN_IN_PAGE = browser.runtime.getURL("/signin.html")
const EXTENSION_ORIGIN = new URL(SIGN_IN_PAGE).origin

const decodeFrameMessage = Schema.decodeUnknownOption(FrameMessage)

const FRAME_HEIGHT_AT_FIRST = 160

interface SignInPopoverProps {
  readonly controlRef: RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly onSignedIn: () => void
}

function SignInPopover({ controlRef, onClose, onSignedIn }: SignInPopoverProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameHeight, setFrameHeight] = useState(FRAME_HEIGHT_AT_FIRST)
  const contextId = useId()

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Any page or frame can post to this window; only our own page, in our own frame, is heard.
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

  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
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
        "absolute bottom-full left-0 z-10 mb-2 flex w-80 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg",
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
        onLoad={() => frameRef.current?.focus()}
      />
    </div>
  )
}

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
