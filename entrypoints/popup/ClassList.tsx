/**
 * The classes the user gets alerts for, each with a "Stop" button.
 *
 *   ClassList          the heading, the rows, or the empty state
 *   ClassRow           one class; stopping its alerts happens here
 *   EmptyState         how to add a class
 *   ClassListSkeleton  grey placeholder rows while the list loads
 */
import { type Ref, useEffect, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { type AppError, type Subscription, subscriptionLabel } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { unsubscribe } from "@/lib/workflows"

const CLASS_SEARCH_URL = "https://classes.oregonstate.edu/"

export function ClassList({ subscriptions }: { readonly subscriptions: ReadonlyArray<Subscription> }) {
  // The classes stopped since the list was loaded. Hiding them here saves
  // loading the whole list again after every "Stop".
  const [stopped, setStopped] = useState<ReadonlyArray<Subscription>>([])
  const headingRef = useRef<HTMLHeadingElement>(null)

  const watching = subscriptions.filter((subscription) => !stopped.includes(subscription))
  const lastStopped = stopped.at(-1)

  function handleStopped(subscription: Subscription) {
    setStopped((earlier) => [...earlier, subscription])
    // The button that had keyboard focus is about to disappear with its row.
    // Move focus to the heading so the next Tab continues from the list.
    headingRef.current?.focus()
  }

  return (
    <>
      <ListHeading ref={headingRef} count={watching.length} />
      {/* Names the class, so a click on the wrong row is noticed and easy to put right. */}
      <Message tone="success">
        {lastStopped &&
          `Stopped alerts for ${subscriptionLabel(lastStopped)}. To watch it again, press "Notify me" on its class page.`}
      </Message>
      {watching.length === 0 ? <EmptyState /> : (
        // The list scrolls when it is long. `max-h-84` (336px) is five and a
        // half rows, so a cut-off row hints that there is more. The negative
        // margins and matching padding let the list reach the popup's sides
        // and the footer's line: the scrollbar sits at the edge, and focus
        // rings are not cut off.
        <ul className="-mx-4 -mt-1 -mb-4 flex max-h-84 flex-col overflow-y-auto px-4 pb-1">
          {watching.map((subscription) => (
            <ClassRow key={subscription.crn} subscription={subscription} onStopped={handleStopped} />
          ))}
        </ul>
      )}
    </>
  )
}

function ClassRow({ subscription, onStopped }: {
  readonly subscription: Subscription
  readonly onStopped: (subscription: Subscription) => void
}) {
  const stop = useAction(unsubscribe)
  const stopButton = useRef<HTMLButtonElement>(null)
  const label = subscriptionLabel(subscription)

  async function handleStop() {
    const result = await stop.run(subscription.crn)
    // "Not subscribed" means the alerts were already stopped somewhere else
    // (on the class page, or in another browser), so the row goes away too.
    if (result.status === "success" || result.error._tag === "NotSubscribed") {
      onStopped(subscription)
    }
    // After any other failure the row stays, with the reason under it.
  }

  // ("Not subscribed" was treated as done above, so it is not shown as an error.)
  const error = stop.state.status === "failure" && stop.state.error._tag !== "NotSubscribed" ? stop.state.error : null

  // A busy button is disabled, and the browser takes keyboard focus away from
  // a disabled button. After a failure, hand it back so Enter tries again
  // (unless the user has moved on to something else in the meantime).
  const failed = error !== null
  useEffect(() => {
    if (failed && document.activeElement === document.body) {
      stopButton.current?.focus()
    }
  }, [failed])

  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* A long name wraps onto more lines instead of being cut off. */}
          <p className="font-medium wrap-break-word">{label}</p>
          {/* Without a name the label already is the CRN. */}
          {subscription.name !== null && <p className="text-xs text-ink-muted">CRN {subscription.crn}</p>}
        </div>
        <Button
          ref={stopButton}
          size="sm"
          // A fixed width, so the row does not shift when the spinner appears.
          className="w-19"
          loading={stop.state.status === "loading"}
          // Screen readers hear which class each "Stop" belongs to.
          aria-label={`Stop alerts for ${label}`}
          onClick={handleStop}
        >
          Stop
        </Button>
      </div>
      <Message tone="error" className="text-xs">
        {error && stopErrorMessage(error)}
      </Message>
    </li>
  )
}

/** Why "Stop" failed. Two cases need different words here than elsewhere. */
function stopErrorMessage(error: AppError): string {
  switch (error._tag) {
    case "ClassNotFound":
      // The server only knows the classes of the current term, so it refuses
      // to touch an alert left over from an earlier one.
      return "This class isn't in the current term, so it can't be stopped here. Use the Unsubscribe button in the confirmation email you got for it."
    case "WrongPin":
      return "Your saved PIN no longer works. Sign out, then sign in again."
    default:
      return errorMessage(error)
  }
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-muted p-4">
      <p>
        You aren't watching any classes yet. To add one, open it on classes.oregonstate.edu and press "Notify me".
      </p>
      <Button variant="primary" onClick={() => void browser.tabs.create({ url: CLASS_SEARCH_URL })}>
        Open class search
      </Button>
    </div>
  )
}

/** Shown while the list loads. Its rows are as tall as real ones, so nothing jumps when they arrive. */
export function ClassListSkeleton() {
  return (
    <>
      <ListHeading />
      <p role="status" className="sr-only">Loading your classes…</p>
      <ul className="-mt-1 -mb-3 flex animate-pulse flex-col" aria-hidden="true">
        {["w-48", "w-56", "w-40"].map((nameWidth) => (
          <li key={nameWidth} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            {/* `h-9` (36px) is a one-line name plus its CRN line. */}
            <div className="flex h-9 flex-1 flex-col justify-between py-1">
              <div className={`h-3 rounded-sm bg-surface-muted ${nameWidth}`} />
              <div className="h-3 w-20 rounded-sm bg-surface-muted" />
            </div>
            <div className="h-8 w-19 rounded-md bg-surface-muted" />
          </li>
        ))}
      </ul>
    </>
  )
}

/** "Classes you're watching", with how many once that is known. */
function ListHeading({ count, ref }: { readonly count?: number; readonly ref?: Ref<HTMLHeadingElement> }) {
  return (
    // `tabIndex={-1}`: can be given focus from code, but is not a Tab stop.
    <h2 ref={ref} tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none">
      Classes you're watching
      {count !== undefined && (
        <span className="rounded-sm bg-surface-muted px-2 text-xs font-medium text-ink-muted">{count}</span>
      )}
    </h2>
  )
}
