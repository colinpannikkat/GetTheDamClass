import { type ComponentProps, useId } from "react"
import { cx } from "./cx"

export interface TextFieldProps extends Omit<ComponentProps<"input">, "id"> {
  /** The visible label, linked to the input for screen readers. */
  readonly label: string
  /** Optional help text under the input. */
  readonly hint?: string
}

/** A labelled text input. Accepts every prop of `<input>`. */
export function TextField({ label, hint, className, ...inputProps }: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="ui-root flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={cx(
          "h-10 w-full rounded-md border border-line-strong bg-surface px-3 font-sans text-sm text-ink",
          "placeholder:text-ink-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ink",
          className
        )}
      />
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
