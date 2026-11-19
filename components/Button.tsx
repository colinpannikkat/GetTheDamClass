import type { ComponentProps } from "react"
import { cx } from "./cx"

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"
export type ButtonSize = "sm" | "md"

export interface ButtonProps extends ComponentProps<"button"> {
  /** `primary` is the one main action; `quiet` has no border. Default: `secondary`. */
  readonly variant?: ButtonVariant
  /** `md` is 40px tall, `sm` is 32px. Default: `md`. */
  readonly size?: ButtonSize
  /** Show a spinner and ignore clicks while work is in progress. */
  readonly loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent enabled:hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink enabled:hover:bg-surface-muted",
  quiet: "text-ink-muted enabled:hover:bg-surface-muted enabled:hover:text-ink",
  danger: "border border-line-strong bg-surface text-danger enabled:hover:bg-danger-soft"
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm"
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-sans font-medium whitespace-nowrap",
        "transition-colors enabled:cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink",
        variantClasses[variant],
        sizeClasses[size],
        // Dim a button that cannot be used, but not one that is busy.
        disabled && !loading && "opacity-50",
        className
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
