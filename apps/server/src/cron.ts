/**
 * When Cloudflare runs the Worker's two jobs, as cron expressions, which
 * Cloudflare reads in UTC. scheduled.ts uses them to tell which job a run is
 * for. cloudflare.config.ts registers the same two, written out again
 * (scheduled.test.ts checks that they agree): change both together.
 */

/** Every minute: the check for open seats (poll.ts). */
export const EVERY_MINUTE = "* * * * *"

/**
 * Every day at 11:00 UTC: the cleanup (cleanup.ts). That is 3 a.m. in Oregon
 * in winter and 4 a.m. in summer, when the fewest students are about. It is
 * also after Oregon's midnight all year, so alerts whose add deadline was the
 * day before end that same morning.
 */
export const DAILY = "0 11 * * *"
