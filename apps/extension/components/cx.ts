export const cx = (...classNames: ReadonlyArray<string | false | null | undefined>): string =>
  classNames.filter(Boolean).join(" ")
