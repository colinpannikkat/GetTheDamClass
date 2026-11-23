import type { ReactNode } from "react"
import { cx } from "./cx"

export type MessageTone = "info" | "success" | "error"

export interface MessageProps {
  readonly tone?: MessageTone
  readonly children?: ReactNode
  readonly className?: string
}

const toneClasses: Record<MessageTone, string> = {
  info: "bg-surface-muted text-ink",
  success: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger"
}

// Screen readers announce text appearing in a live region already on the page, so keep `<Message>`
// rendered and change its children.
export function Message({ tone = "info", children, className }: MessageProps) {
  const isEmpty = children === null || children === undefined || children === false || children === ""
  return (
    <div
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
