import { DateTime } from "effect"
import { TestClock } from "effect/testing"

export const setOregonTime = (local: string) =>
  TestClock.setTime(
    DateTime.toEpochMillis(DateTime.makeZonedUnsafe(local, { timeZone: "America/Los_Angeles", adjustForTimeZone: true }))
  )
