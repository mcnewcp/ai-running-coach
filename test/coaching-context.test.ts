import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offSeason, runnerProfile, springHalf } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase, resetDocuments, writeRunnerProfile } from "./mcp";

// All Programs, Runs, Shoes and documents here are synthetic.

type Client = Awaited<ReturnType<typeof connect>>;

const basePlanPath = "Programs/2026-11-off-season/Plans/base.md";
const basePlan = "# Base\n\nMonday: rest\nTuesday: 4 mi easy\nThursday: 5 mi easy\nSaturday: 7 mi long\n";

beforeEach(async () => {
  await resetDatabase();
  await resetDocuments();
  // Fake only the clock: the MCP transport still needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday 2026-11-25, noon in the Home Timezone (America/Chicago). Weeks
  // run Monday–Sunday: 2026-11-16 and 2026-11-23 are Mondays.
  vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A season with a Runner Profile, the Off-season's Base Phase linked to its Plan. */
async function season(): Promise<Client> {
  const client = await connect();
  await writeRunnerProfile(client, runnerProfile("name: Synthetic Runner\ntimezone: America/Chicago"));
  await callTool(client, "upsert_program", {
    ...offSeason,
    phases: offSeason.phases.map((phase) => (phase.name === "Base" ? { ...phase, planPath: basePlanPath } : phase)),
  });
  await callTool(client, "upsert_program", springHalf);
  return client;
}

async function coachingContext(client: Client, args: Record<string, unknown> = {}) {
  return callTool(client, "get_coaching_context", args);
}

describe("get_coaching_context", () => {
  it("returns everything a coaching session starts from in one call", async () => {
    const client = await season();
    const plan = await callTool(client, "write_document", { path: basePlanPath, content: basePlan, create_only: true });
    await callTool(client, "add_shoe", { id: "trainer-blue", model: "Synthetic Trainer 3" });
    await callTool(client, "add_shoe", { id: "racer-red" });
    await callTool(client, "add_shoe", { id: "old-grey" });
    await callTool(client, "log_run", { date: "2026-11-10", distance: 3, shoe: "old-grey" });
    await callTool(client, "retire_shoe", { id: "old-grey", date: "2026-11-11" });
    await callTool(client, "log_run", { date: "2026-11-17", distance: 5, shoe: "trainer-blue", type: "Easy" });
    await callTool(client, "log_run", { date: "2026-11-21", distance: 6, shoe: "trainer-blue", type: "Long" });
    await callTool(client, "log_run", { date: "2026-11-23", distance: 4, shoe: "racer-red", type: "Tempo" });
    await callTool(client, "log_run", { date: "2026-11-24", distance: 3.1, type: "Easy", notes: "Felt fresh" });

    const context = await coachingContext(client);

    expect(context.today).toEqual({
      date: "2026-11-25",
      weekday: "Wednesday",
      timezone: "America/Chicago",
      timezoneSource: "home",
    });
    expect(context.runnerProfile).toMatchObject({
      path: "Runner Profile.md",
      content: expect.stringContaining("# Runner Profile"),
      version: expect.any(String),
      properties: { name: "Synthetic Runner", timezone: "America/Chicago" },
    });
    expect(context.program).toMatchObject({
      name: "2026 Off-season",
      kind: "bridge",
      phases: [{ name: "Recovery" }, { name: "Base" }],
    });
    expect(context.phase).toEqual({
      name: "Base",
      kind: "training",
      startDate: "2026-11-16",
      endDate: "2026-12-27",
      focus: "Easy aerobic",
      mileageTarget: "15-20 mi/wk",
      planPath: basePlanPath,
    });
    expect(context.plan).toEqual({ path: basePlanPath, content: basePlan, version: plan.version });
    expect(context.week).toEqual({
      start: "2026-11-23",
      end: "2026-11-29",
      miles: 7.1,
      previousWeekMiles: 11,
      cap: 12.1,
    });
    // The 14 days ending today, newest first.
    const recentRuns = context.recentRuns as Record<string, unknown>[];
    expect(recentRuns.map((run) => [run.date, run.distance])).toEqual([
      ["2026-11-24", 3.1],
      ["2026-11-23", 4],
      ["2026-11-21", 6],
      ["2026-11-17", 5],
    ]);
    expect(recentRuns[0]).toMatchObject({ id: expect.any(Number), type: "Easy", notes: "Felt fresh", shoe: null });
    // Active Shoes only, with their derived mileage.
    expect((context.shoes as Record<string, unknown>[]).map((shoe) => [shoe.id, shoe.mileage])).toEqual([
      ["racer-red", 4],
      ["trainer-blue", 11],
    ]);
  });

  it("leaves out Runs older than 14 days, and any dated after today", async () => {
    const client = await season();
    for (const date of ["2026-11-11", "2026-11-12", "2026-11-25", "2026-11-26"]) {
      await callTool(client, "log_run", { date, distance: 2 });
    }
    const context = await coachingContext(client);
    expect((context.recentRuns as { date: string }[]).map((run) => run.date)).toEqual(["2026-11-25", "2026-11-12"]);
  });

  it("re-attributes a recorded Run when upsert_phase moves its Phase's window", async () => {
    const client = await season();
    const logged = await callTool(client, "log_run", { date: "2026-11-24", distance: 4 });
    expect(logged.phase).toMatchObject({ name: "Base" });
    const runId = (logged.run as { id: number }).id;
    const runPhase = async () =>
      (
        await callTool(client, "query", {
          sql: `SELECT ph.name FROM runs r JOIN phases ph ON r.date BETWEEN ph.start_date AND ph.end_date WHERE r.id = ${runId}`,
        })
      ).rows;
    expect(await runPhase()).toEqual([["Base"]]);

    // Recovery is extended to the end of the week, taking the Run and today with it.
    await callTool(client, "upsert_phase", {
      program: "2026 Off-season",
      name: "Recovery",
      startDate: "2026-11-02",
      endDate: "2026-11-29",
      moveNeighbours: true,
    });

    expect(await runPhase()).toEqual([["Recovery"]]);
    const context = await coachingContext(client);
    expect(context.phase).toMatchObject({ name: "Recovery", startDate: "2026-11-02", endDate: "2026-11-29" });
    expect((context.recentRuns as { id: number }[]).map((run) => run.id)).toEqual([runId]);
    expect(await callTool(client, "update_run", { id: runId, notes: "Easy" })).toMatchObject({
      run: { id: runId, notes: "Easy" },
      phase: { name: "Recovery" },
    });
    expect(await callTool(client, "log_run", { date: "2026-11-25", distance: 3 })).toMatchObject({ phase: { name: "Recovery" } });
  });

  describe("handles missing pieces without failing", () => {
    it("no Runs this week or before, and no Shoes", async () => {
      const context = await coachingContext(await season());
      expect(context.week).toEqual({ start: "2026-11-23", end: "2026-11-29", miles: 0, previousWeekMiles: 0, cap: 0 });
      expect(context.recentRuns).toEqual([]);
      expect(context.shoes).toEqual([]);
    });

    it("a Plan linked but not written yet", async () => {
      const context = await coachingContext(await season());
      expect(context.phase).toMatchObject({ name: "Base", planPath: basePlanPath });
      expect(context.plan).toBeNull();
    });

    it("no Plan linked to the Phase", async () => {
      const client = await season();
      // Tuesday 2026-11-10 falls in the Recovery Phase, which has no Plan.
      vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
      const context = await coachingContext(client);
      expect(context.phase).toMatchObject({ name: "Recovery", planPath: null });
      expect(context.plan).toBeNull();
    });

    it("no Program or Phase covering today", async () => {
      const client = await connect();
      await writeRunnerProfile(client, runnerProfile());
      const context = await coachingContext(client);
      expect(context).toMatchObject({ program: null, phase: null, plan: null, recentRuns: [], shoes: [] });
      expect(context.today).toMatchObject({ date: "2026-11-25" });
      expect(context.week).toMatchObject({ start: "2026-11-23", miles: 0 });
    });
  });

  describe("timezone", () => {
    it("uses the runner's current timezone when given", async () => {
      const client = await season();
      await callTool(client, "log_run", { date: "2026-11-29", distance: 8 });
      // Sunday 2026-11-29, 20:00 in Chicago: already Monday 2026-11-30 in Tokyo, a new week.
      vi.setSystemTime(new Date("2026-11-30T02:00:00Z"));

      expect(await coachingContext(client)).toMatchObject({
        today: { date: "2026-11-29", weekday: "Sunday", timezoneSource: "home" },
        week: { start: "2026-11-23", miles: 8 },
      });
      expect(await coachingContext(client, { timezone: "Asia/Tokyo" })).toMatchObject({
        today: { date: "2026-11-30", weekday: "Monday", timezone: "Asia/Tokyo", timezoneSource: "given" },
        week: { start: "2026-11-30", miles: 0, previousWeekMiles: 8, cap: 8.8 },
      });
    });

    it("doesn't need a Runner Profile when the timezone is given", async () => {
      const context = await coachingContext(await connect(), { timezone: "Europe/London" });
      expect(context).toMatchObject({ today: { timezoneSource: "given" }, runnerProfile: null });
    });

    it("fails clearly, without guessing, when there's no Runner Profile and no timezone", async () => {
      const error = await callToolExpectingError(await connect(), "get_coaching_context");
      expect(error).toMatch(/no Runner Profile/);
    });

    it("fails clearly when the Runner Profile's timezone isn't valid and no timezone is given", async () => {
      const client = await connect();
      await writeRunnerProfile(client, runnerProfile("timezone: EST"));
      expect(await callToolExpectingError(client, "get_coaching_context")).toMatch(/"EST" is not an IANA timezone/);
    });

    it("rejects a given timezone that isn't an IANA timezone", async () => {
      const error = await callToolExpectingError(await connect(), "get_coaching_context", { timezone: "CST" });
      expect(error).toMatch(/"CST" is not an IANA timezone/);
    });
  });
});
