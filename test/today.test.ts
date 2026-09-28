import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, callToolExpectingError, connect } from "./mcp";

// Until the Runner Profile holds the Home Timezone (#8, #9), it's
// America/Chicago. In 2026 its DST starts 2026-03-08 at 02:00 (08:00Z) and ends
// 2026-11-01 at 02:00 (07:00Z).

beforeEach(() => {
  // Fake only the clock: the MCP transport still needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function todayAt(instant: string, args: { timezone?: string } = {}) {
  vi.setSystemTime(new Date(instant));
  return callTool(await connect(), "today", args);
}

describe("today", () => {
  it("returns the local date and weekday in the Home Timezone by default", async () => {
    expect(await todayAt("2026-09-24T16:00:00Z")).toEqual({
      date: "2026-09-24",
      weekday: "Thursday",
      timezone: "America/Chicago",
      timezoneSource: "home",
    });
  });

  it.each([
    ["in standard time", "2026-01-15T05:59:59Z", "2026-01-14", "Wednesday"],
    ["in standard time", "2026-01-15T06:00:00Z", "2026-01-15", "Thursday"],
    ["in daylight time", "2026-07-01T04:59:59Z", "2026-06-30", "Tuesday"],
    ["in daylight time", "2026-07-01T05:00:00Z", "2026-07-01", "Wednesday"],
  ])("turns over at local midnight %s (%s)", async (_, instant, date, weekday) => {
    expect(await todayAt(instant)).toMatchObject({ date, weekday });
  });

  it.each([
    ["just before the clocks spring forward", "2026-03-08T07:59:59Z", "2026-03-08", "Sunday"],
    ["just after the clocks spring forward", "2026-03-08T08:00:00Z", "2026-03-08", "Sunday"],
    ["the first local midnight after spring forward", "2026-03-09T05:00:00Z", "2026-03-09", "Monday"],
    ["a second before that midnight", "2026-03-09T04:59:59Z", "2026-03-08", "Sunday"],
    ["just before the clocks fall back", "2026-11-01T06:59:59Z", "2026-11-01", "Sunday"],
    ["just after the clocks fall back", "2026-11-01T07:00:00Z", "2026-11-01", "Sunday"],
    ["the first local midnight after fall back", "2026-11-02T06:00:00Z", "2026-11-02", "Monday"],
    ["a second before that midnight", "2026-11-02T05:59:59Z", "2026-11-01", "Sunday"],
  ])("is right across a DST change: %s", async (_, instant, date, weekday) => {
    expect(await todayAt(instant)).toMatchObject({ date, weekday });
  });

  describe("when given the runner's current timezone", () => {
    it("uses it instead of the Home Timezone", async () => {
      // 11:59:59 PM Thursday in Auckland, still morning in Chicago.
      expect(await todayAt("2026-09-24T11:59:59Z", { timezone: "Pacific/Auckland" })).toEqual({
        date: "2026-09-24",
        weekday: "Thursday",
        timezone: "Pacific/Auckland",
        timezoneSource: "given",
      });
      expect(await todayAt("2026-09-24T12:00:00Z", { timezone: "Pacific/Auckland" })).toMatchObject({
        date: "2026-09-25",
        weekday: "Friday",
      });
    });

    it("can put the runner on a different day from home", async () => {
      // Late Wednesday evening in Chicago is already Thursday in Tokyo.
      const instant = "2026-09-24T03:00:00Z";
      expect(await todayAt(instant)).toMatchObject({ date: "2026-09-23", weekday: "Wednesday" });
      expect(await todayAt(instant, { timezone: "Asia/Tokyo" })).toMatchObject({
        date: "2026-09-24",
        weekday: "Thursday",
      });
    });

    it("rejects a timezone that isn't an IANA timezone", async () => {
      const client = await connect();
      for (const timezone of ["Mars/Olympus_Mons", "CST", ""]) {
        expect(await callToolExpectingError(client, "today", { timezone })).toMatch(/IANA timezone/);
      }
    });
  });
});
