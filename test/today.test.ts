import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, callToolExpectingError, connect } from "./mcp";

// The configured timezone in vitest.config.ts is America/New_York (synthetic).
// In 2026 its DST starts 2026-03-08 at 02:00 (07:00Z) and ends 2026-11-01 at
// 02:00 (06:00Z).

beforeEach(() => {
  // Fake only the clock: the MCP transport still needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function todayAt(instant: string, settings = {}) {
  vi.setSystemTime(new Date(instant));
  return callTool(await connect(settings), "today");
}

describe("today", () => {
  it("returns the local date, weekday and timezone", async () => {
    expect(await todayAt("2026-09-24T16:00:00Z")).toEqual({
      date: "2026-09-24",
      weekday: "Thursday",
      timezone: "America/New_York",
    });
  });

  it.each([
    ["in standard time", "2026-01-15T04:59:59Z", "2026-01-14", "Wednesday"],
    ["in standard time", "2026-01-15T05:00:00Z", "2026-01-15", "Thursday"],
    ["in daylight time", "2026-07-01T03:59:59Z", "2026-06-30", "Tuesday"],
    ["in daylight time", "2026-07-01T04:00:00Z", "2026-07-01", "Wednesday"],
  ])("turns over at local midnight %s (%s)", async (_, instant, date, weekday) => {
    expect(await todayAt(instant)).toMatchObject({ date, weekday });
  });

  it.each([
    ["just before the clocks spring forward", "2026-03-08T06:59:59Z", "2026-03-08", "Sunday"],
    ["just after the clocks spring forward", "2026-03-08T07:00:00Z", "2026-03-08", "Sunday"],
    ["the first local midnight after spring forward", "2026-03-09T04:00:00Z", "2026-03-09", "Monday"],
    ["an hour before that midnight", "2026-03-09T03:59:59Z", "2026-03-08", "Sunday"],
    ["just before the clocks fall back", "2026-11-01T05:59:59Z", "2026-11-01", "Sunday"],
    ["just after the clocks fall back", "2026-11-01T06:00:00Z", "2026-11-01", "Sunday"],
    ["the first local midnight after fall back", "2026-11-02T05:00:00Z", "2026-11-02", "Monday"],
    ["an hour after the old offset's midnight", "2026-11-02T04:59:59Z", "2026-11-01", "Sunday"],
  ])("is right across a DST change: %s", async (_, instant, date, weekday) => {
    expect(await todayAt(instant)).toMatchObject({ date, weekday });
  });

  it("follows whichever timezone is configured", async () => {
    const settings = { ATHLETE_TIMEZONE: "Pacific/Auckland" };
    expect(await todayAt("2026-09-24T11:59:59Z", settings)).toEqual({
      date: "2026-09-24",
      weekday: "Thursday",
      timezone: "Pacific/Auckland",
    });
    expect(await todayAt("2026-09-24T12:00:00Z", settings)).toMatchObject({
      date: "2026-09-25",
      weekday: "Friday",
    });
  });

  it.each([
    ["missing", ""],
    ["not an IANA timezone", "Mars/Olympus_Mons"],
  ])("fails clearly when the timezone setting is %s", async (_, timezone) => {
    const client = await connect({ ATHLETE_TIMEZONE: timezone });
    expect(await callToolExpectingError(client, "today")).toMatch(/ATHLETE_TIMEZONE/);
  });
});
