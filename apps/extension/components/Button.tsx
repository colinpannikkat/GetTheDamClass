import type { ComponentProps } from "react"
import { cx } from "./cx"

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"
export type ButtonSize = "sm" | "md"

export interface ButtonProps extends ComponentProps<"button"> {
  /**
   * `primary` is the one main action; `quiet` has no border; `danger`
   * confirms something that cannot be undone. Default: `secondary`.
   */
  readonly variant?: ButtonVariant
  /** `md` is 40px tall, `sm` is 32px. Default: `md`. */
  readonly size?: ButtonSize
  /** Show a spinner and ignore presses while work is in progress. */
  readonly loading?: boolean
  /** Ignore presses for any other reason, such as nothing being left to do. */
  readonly "aria-disabled"?: boolean
}

// `not-aria-disabled:` styles apply only while the button can be pressed.
const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent not-aria-disabled:hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink not-aria-disabled:hover:bg-surface-muted",
  quiet: "text-ink-muted not-aria-disabled:hover:bg-surface-muted not-aria-disabled:hover:text-ink",
  // Text in the page's background colour: the danger red is dark in light
  // mode and light in dark mode, so this keeps the contrast in both.
  danger: "bg-danger text-surface not-aria-disabled:hover:bg-danger/85"
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm"
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  "aria-disabled": ariaDisabled = false,
  type = "button",
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  // A button that cannot be pressed right now says so with `aria-disabled`
  // and ignores presses. It never gets the `disabled` attribute: the browser
  // takes keyboard focus away from a disabled button, and a keyboard user
  // would lose their place every time a button is busy.
  const inactive = loading || ariaDisabled
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      // `preventDefault` keeps an inactive submit button from sending its form.
      onClick={inactive ? (event) => event.preventDefault() : onClick}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-sans font-medium whitespace-nowrap",
        "transition-colors not-aria-disabled:cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink",
        variantClasses[variant],
        sizeClasses[size],
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
