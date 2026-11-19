/**
 * Setting the test's clock to a time of day in Oregon, so tests can sit on
 * either side of a Pacific midnight. The server reads the time from the same
 * clock (see TestServer.ts).
 */
import { DateTime } from "effect"
import { TestClock } from "effect/testing"

/** Set the clock to this local time in Oregon: "2027-01-17T23:59". */
export const setOregonTime = (local: string) =>
  TestClock.setTime(
    DateTime.toEpochMillis(DateTime.makeZonedUnsafe(local, { timeZone: "America/Los_Angeles", adjustForTimeZone: true }))
  )
