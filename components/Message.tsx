import type { ReactNode } from "react"
import { cx } from "./cx"

export type MessageTone = "info" | "success" | "error"

export interface MessageProps {
  /** Default: `info`. */
  readonly tone?: MessageTone
  /** The text to show. Pass `null` (or nothing) to show no message. */
  readonly children?: ReactNode
  readonly className?: string
}

const toneClasses: Record<MessageTone, string> = {
  info: "bg-surface-muted text-ink",
  success: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger"
}

/**
 * A short inline message: feedback after an action, or an error.
 *
 * Screen readers announce text that appears inside a "live region" which is
 * already on the page. So render `<Message>` all the time and change its
 * children, instead of adding and removing the whole component:
 *
 *   <Message tone="error">{failed ? "Could not save." : null}</Message>
 */
export function Message({ tone = "info", children, className }: MessageProps) {
  const isEmpty = children === null || children === undefined || children === false || children === ""
  return (
    // The live region. `contents` means it has no box of its own, so an empty
    // message takes up no room (not even a gap in a flex layout).
    <div
      // Errors interrupt the screen reader; other messages wait their turn.
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className="contents"
    >
      {!isEmpty && (
        <p className={cx("ui-root rounded-md px-3 py-2", toneClasses[tone], className)}>
          {children}
        </p>
      )}
    </div>
  )
}
