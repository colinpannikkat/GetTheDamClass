/** Join class names, skipping the ones that are switched off: `cx("a", isOn && "b")`. */
export const cx = (...classNames: ReadonlyArray<string | false | null | undefined>): string =>
  classNames.filter(Boolean).join(" ")
