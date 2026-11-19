import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { addDeadline, todayInOregon } from "./termRule"

// How the term rule refuses a subscribe, and which sentences it uses, is
// tested through the API in alerts.test.ts. These are the two calculations
// underneath.

describe("addDeadline", () => {
  it.each([
    {
      title: "starting on a Monday: the Sunday ending its second week",
      dates: { starts: ["2027-01-04"], ends: ["2027-03-12"] },
      deadline: "2027-01-17"
    },
    {
      title: "starting midweek: counted from the next Monday",
      dates: { starts: ["2027-01-06"], ends: ["2027-03-12"] },
      deadline: "2027-01-24"
    },
    {
      title: "starting on a Sunday: counted from the next day",
      dates: { starts: ["2027-01-03"], ends: ["2027-03-12"] },
      deadline: "2027-01-17"
    },
    {
      // Monday 2027-06-21 to Sunday 2027-07-25 is 35 days: five whole weeks.
      title: "running five weeks: the Sunday ending its first week",
      dates: { starts: ["2027-06-21"], ends: ["2027-07-25"] },
      deadline: "2027-06-27"
    },
    {
      // Monday 2027-06-21 to Monday 2027-07-26 is 36 days: it reaches a sixth week.
      title: "reaching into a sixth week: not a short session",
      dates: { starts: ["2027-06-21"], ends: ["2027-07-26"] },
      deadline: "2027-07-04"
    },
    {
      // Monday 2027-06-21 to Friday 2027-07-30: what a six-week session looks like.
      title: "running six weeks, to a Friday: not a short session",
      dates: { starts: ["2027-06-21"], ends: ["2027-07-30"] },
      deadline: "2027-07-04"
    },
    {
      title: "with several meeting times: from the earliest start",
      dates: { starts: ["2027-01-11", "2027-01-06"], ends: ["2027-03-12", "2027-03-10"] },
      deadline: "2027-01-24"
    },
    {
      // Each meeting time alone is short; together they run eight weeks.
      title: "with several meeting times: its length runs to the latest end",
      dates: { starts: ["2027-07-19", "2027-06-21"], ends: ["2027-08-13", "2027-07-16"] },
      deadline: "2027-07-04"
    },
    {
      title: "without an end date: not taken for a short session",
      dates: { starts: ["2027-06-21"], ends: [] },
      deadline: "2027-07-04"
    }
  ])("a class $title", ({ dates, deadline }) => {
    assert.strictEqual(addDeadline(dates), deadline)
  })

  it("a class without a start date has none", () => {
    assert.isUndefined(addDeadline({ starts: [], ends: [] }))
    assert.isUndefined(addDeadline({ starts: [], ends: ["2027-03-12"] }))
  })
})

describe("todayInOregon", () => {
  it.effect.each([
    { title: "standard time, UTC-8: the last minute of a day", utc: "2027-01-18T07:59:00Z", today: "2027-01-17" },
    { title: "standard time, UTC-8: the first minute of the next", utc: "2027-01-18T08:00:00Z", today: "2027-01-18" },
    { title: "daylight-saving time, UTC-7: the last minute of a day", utc: "2027-07-05T06:59:00Z", today: "2027-07-04" },
    { title: "daylight-saving time, UTC-7: the first minute of the next", utc: "2027-07-05T07:00:00Z", today: "2027-07-05" }
  ])("follows Oregon's calendar, not UTC's: $title", ({ today, utc }) =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse(utc))
      assert.strictEqual(yield* todayInOregon, today)
    }))
})
