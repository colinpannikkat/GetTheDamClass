// cloudflare.config.ts repeats these (scheduled.test.ts checks they agree): change both together.
import { Effect } from "effect"
import { cleanup } from "./cleanup"
import { pollClasses } from "./poll"

export const EVERY_MINUTE = "* * * * *"

// 3 or 4 a.m. in Oregon, and after Oregon's midnight all year, so alerts past their add deadline end that morning.
export const DAILY = "0 11 * * *"

export const runScheduled = (cron: string) => {
  switch (cron) {
    case EVERY_MINUTE:
      return pollClasses()
    case DAILY:
      return cleanup()
    default:
      return Effect.die(new Error(`No job runs on the schedule "${cron}"`))
  }
}
