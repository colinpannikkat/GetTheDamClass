/**
 * What the Worker's `scheduled` handler (index.ts) runs: Cloudflare calls it
 * for each run of a cron trigger, with that trigger's cron expression, and
 * the expression says which job it is.
 */
import { Effect } from "effect"
import { cleanup } from "./cleanup"
import { DAILY, EVERY_MINUTE } from "./cron"
import { pollClasses } from "./poll"

/** The job for this cron expression. */
export const runScheduled = (cron: string) => {
  switch (cron) {
    case EVERY_MINUTE:
      return pollClasses()
    case DAILY:
      return cleanup()
    default:
      // Only a trigger added to cloudflare.config.ts without a job here gets
      // this far. Failing makes the run show as an error in Cloudflare.
      return Effect.die(new Error(`No job runs on the schedule "${cron}"`))
  }
}
