/**
 * The Worker's two jobs: when Cloudflare runs them, and which one a run is.
 *
 * The times are cron expressions, which Cloudflare reads in UTC.
 * cloudflare.config.ts registers the same two, written out again
 * (scheduled.test.ts checks that they agree): change both together. For each
 * run, Cloudflare calls the Worker's `scheduled` handler (index.ts) with the
 * trigger's expression, and `runScheduled` tells the job by it.
 */
import { Effect } from "effect"
import { cleanup } from "./cleanup"
import { pollClasses } from "./poll"

/** Every minute: the check for open seats (poll.ts). */
export const EVERY_MINUTE = "* * * * *"

/**
 * Every day at 11:00 UTC: the cleanup (cleanup.ts). That is 3 a.m. in Oregon
 * in winter and 4 a.m. in summer, when the fewest students are about. It is
 * also after Oregon's midnight all year, so alerts whose add deadline was the
 * day before end that same morning.
 */
export const DAILY = "0 11 * * *"

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
