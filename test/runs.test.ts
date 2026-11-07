import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All Programs, Runs and Shoes here are synthetic.

beforeEach(resetDatabase);

type Client = Awaited<ReturnType<typeof connect>>;

// Weeks run Monday–Sunday: 2026-10-26, 2026-11-02 and 2026-11-09 are Mondays.
const fallBase = {
  name: "2026 Fall Base",
  kind: "bridge",
  startDate: "2026-10-05",
  endDate: "2026-12-27",
  phases: [
    { name: "Rebuild", startDate: "2026-10-05", endDate: "2026-11-01", focus: "Return to running" },
    { name: "Base", startDate: "2026-11-02", endDate: "2026-12-27", focus: "Easy aerobic" },
  ],
};

async function season(): Promise<Client> {
  const client = await connect();
  await callTool(client, "upsert_program", fallBase);
  return client;
}

/** Logs Runs of `distance` miles on each date. */
async function logRuns(client: Client, runs: [date: string, distance: number][]): Promise<void> {
  for (const [date, distance] of runs) await callTool(client, "log_run", { date, distance });
}

/** The miles recorded in the Monday–Sunday week containing `date`. */
async function weekMiles(client: Client, date: string): Promise<number> {
  const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 0, week: date });
  return (output.week as { miles: number }).miles;
}

describe("log_run", () => {
  it("records a Run with its derived Phase and Program, leaving missing fields empty", async () => {
    const client = await season();
    const output = await callTool(client, "log_run", { date: "2026-11-03", distance: 3.1 });
    expect(output.run).toEqual({
      id: expect.any(Number),
      date: "2026-11-03",
      type: null,
      distance: 3.1,
      duration: null,
      pace: null,
      avgHr: null,
      vo2Max: null,
      shoe: null,
      leftKneePain: null,
      rightKneePain: null,
      notes: null,
      program: "2026 Fall Base",
      phase: "Base",
    });
  });

  it("records every reported field and derives pace from distance and duration", async () => {
    const client = await season();
    const output = await callTool(client, "log_run", {
      date: "2026-10-31",
      type: "Long",
      distance: 6.2,
      duration: "1:01:23",
      avgHr: 148,
      vo2Max: 47.5,
      leftKneePain: 1,
      rightKneePain: 0,
      notes: "Felt smooth",
    });
    expect(output.run).toMatchObject({
      date: "2026-10-31",
      type: "Long",
      distance: 6.2,
      duration: "1:01:23",
      pace: "9:54",
      avgHr: 148,
      vo2Max: 47.5,
      leftKneePain: 1,
      rightKneePain: 0,
      notes: "Felt smooth",
      phase: "Rebuild",
    });
  });

  it.each([
    ["27:45", 3, "27:45", "9:15"],
    ["0:27:45", 3, "27:45", "9:15"],
    ["5:00", 0.5, "5:00", "10:00"],
    ["1:00:00", 7, "1:00:00", "8:34"],
  ])("normalises duration %s over %s mi and rounds pace to the second", async (duration, distance, normalised, pace) => {
    const client = await season();
    const output = await callTool(client, "log_run", { date: "2026-11-03", distance, duration });
    expect(output.run).toMatchObject({ duration: normalised, pace });
  });

  it.each([
    ["a date outside every Phase", { date: "2027-01-04" }, /No Phase covers 2027-01-04. Programs cover 2026-10-05 to 2026-12-27/],
    ["a date that isn't a calendar date", { date: "2026-11-31" }, /not a calendar date/],
    ["an unknown Shoe", { shoe: "mystery-pair" }, /There's no Shoe mystery-pair. Add it with add_shoe first/],
    ["a zero distance", { distance: 0 }, /distance must be more than 0 miles/],
    ["a negative distance", { distance: -2 }, /distance must be more than 0 miles/],
    ["a pain rating above 10", { leftKneePain: 11 }, /leftKneePain must be 0-10/],
    ["a negative pain rating", { rightKneePain: -1 }, /rightKneePain must be 0-10/],
    ["a non-positive heart rate", { avgHr: 0 }, /avgHr must be more than 0/],
  ])("rejects %s, recording nothing", async (_, change, error) => {
    const client = await season();
    expect(await callToolExpectingError(client, "log_run", { date: "2026-11-03", distance: 3, ...change })).toMatch(error);
    expect(await weekMiles(client, "2026-11-03")).toBe(0);
  });

  it("rejects a duration it can't read", async () => {
    const client = await season();
    for (const duration of ["45", "1:75:00", "abc", "0:00"]) {
      expect(await callToolExpectingError(client, "log_run", { date: "2026-11-03", distance: 3, duration })).toMatch(
        /duration .* h:mm:ss or m:ss/,
      );
    }
  });

  it("reports where the Run's week stands against its Mileage Cap", async () => {
    const client = await season();
    // The previous week, Monday 2026-10-26 to Sunday 2026-11-01: 13 miles.
    await logRuns(client, [
      ["2026-10-26", 4],
      ["2026-10-29", 3.5],
      ["2026-11-01", 5.5],
    ]);
    await logRuns(client, [["2026-11-02", 4.1]]);
    const output = await callTool(client, "log_run", { date: "2026-11-05", distance: 10 });
    expect(output.week).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
      miles: 14.1,
      previousWeekMiles: 13,
      cap: 14.3,
    });
  });
});

describe("weeks and the Mileage Cap", () => {
  it("counts Monday through Sunday, and nothing either side", async () => {
    const client = await season();
    await logRuns(client, [
      ["2026-11-01", 1], // Sunday before
      ["2026-11-02", 2], // Monday
      ["2026-11-08", 3], // Sunday
      ["2026-11-09", 4], // Monday after
    ]);
    expect(await weekMiles(client, "2026-11-02")).toBe(5);
    expect(await weekMiles(client, "2026-11-05")).toBe(5);
    expect(await weekMiles(client, "2026-11-08")).toBe(5);
    expect(await weekMiles(client, "2026-11-09")).toBe(4);
    expect(await weekMiles(client, "2026-11-01")).toBe(1);
  });

  it("sets the cap at the previous week's actual miles × 1.10", async () => {
    const client = await season();
    await logRuns(client, [
      ["2026-11-02", 3.1],
      ["2026-11-04", 4.2],
      ["2026-11-08", 8.7],
    ]);
    const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 17, week: "2026-11-12" });
    expect(output).toEqual({
      week: { start: "2026-11-09", end: "2026-11-15", miles: 0, previousWeekMiles: 16, cap: 17.6 },
      cap: 17.6,
      proposed: 17,
      exceeds: false,
      delta: -0.6,
    });
  });

  it("is zero after a week without Runs", async () => {
    const client = await season();
    await logRuns(client, [["2026-10-26", 5]]);
    const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 3, week: "2026-11-09" });
    expect(output).toMatchObject({ cap: 0, proposed: 3, exceeds: true, delta: 3 });
  });
});

describe("check_mileage_cap", () => {
  async function capCheck(proposed: number) {
    const client = await season();
    await logRuns(client, [["2026-11-03", 20]]);
    return callTool(client, "check_mileage_cap", { proposed_week_miles: proposed, week: "2026-11-09" });
  }

  it("reports a proposed week over the cap without blocking anything", async () => {
    expect(await capCheck(24.5)).toMatchObject({ cap: 22, proposed: 24.5, exceeds: true, delta: 2.5 });
  });

  it("treats a week exactly at the cap as within it", async () => {
    expect(await capCheck(22)).toMatchObject({ cap: 22, proposed: 22, exceeds: false, delta: 0 });
  });

  it("takes any date in the week, and reports the week it used", async () => {
    const client = await season();
    for (const week of ["2026-11-09", "2026-11-11", "2026-11-15"]) {
      const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 10, week });
      expect(output.week).toMatchObject({ start: "2026-11-09", end: "2026-11-15" });
    }
  });

  describe("without a week", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Sunday 2026-11-08, 21:00 in the Home Timezone (America/Chicago); already Monday in London.
      vi.setSystemTime(new Date("2026-11-09T03:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("checks this week in the Home Timezone", async () => {
      const client = await season();
      const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 10 });
      expect(output.week).toMatchObject({ start: "2026-11-02", end: "2026-11-08" });
    });

    it("checks this week in the runner's current timezone when given", async () => {
      const client = await season();
      const output = await callTool(client, "check_mileage_cap", { proposed_week_miles: 10, timezone: "Europe/London" });
      expect(output.week).toMatchObject({ start: "2026-11-09", end: "2026-11-15" });
    });
  });

  it("rejects a negative proposal or a week that isn't a date", async () => {
    const client = await season();
    expect(await callToolExpectingError(client, "check_mileage_cap", { proposed_week_miles: -1, week: "2026-11-09" })).toMatch(
      /proposed_week_miles can't be negative/,
    );
    expect(await callToolExpectingError(client, "check_mileage_cap", { proposed_week_miles: 10, week: "next week" })).toMatch(
      /not a calendar date/,
    );
  });
});
