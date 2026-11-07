import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type ArchiveSource, rebuildStructuredRecord } from "../src/import";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// The import rebuilds D1 from a checkout of the private archive. These tests
// import a synthetic archive (test/fixtures/archive) that has the archive's
// shape but no real Athlete Record data, then check the result through the
// MCP tools.

beforeEach(resetDatabase);

const fixtureFiles = import.meta.glob("./fixtures/archive/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The synthetic archive, read from test/fixtures/archive. */
const fixture: ArchiveSource = {
  read: (path) => fixtureFiles[`./fixtures/archive/${path}`] ?? null,
};

async function importFixture() {
  return rebuildStructuredRecord(env.DB, fixture);
}

describe("the structured import", () => {
  it("builds the Programs and Phases, including the pre-build Program and the A-race's Race Phase", async () => {
    await importFixture();
    const client = await connect();
    const placed = async (date: string) => {
      const { program, phase } = (await callTool(client, "phase_for_date", { date })) as {
        program: { name: string };
        phase: { name: string; kind: string };
      };
      return [program.name, phase.name, phase.kind];
    };
    expect(await placed("2031-01-06")).toEqual(["Synthetic Pre-build", "Pre-build", "training"]);
    expect(await placed("2031-03-01")).toEqual(["2031 Synthetic Spring Half", "Build", "training"]);
    expect(await placed("2031-04-12")).toEqual(["2031 Synthetic Spring Half", "Race", "race"]);
    expect(await placed("2031-06-29")).toEqual(["2031 Synthetic Off-season", "Base", "training"]);
  });

  it("loads the Shoes from the shoe log and the Runs worn in them, retiring a retired pair on its last Run", async () => {
    await importFixture();
    const client = await connect();
    const { shoes } = (await callTool(client, "list_shoes", { includeRetired: true })) as { shoes: unknown[] };
    expect(shoes).toContainEqual(
      expect.objectContaining({
        id: "trainer-blue",
        model: "Synthetic Trainer 3",
        status: "retired",
        retiredDate: "2031-01-23",
        mileage: 6.1,
        runs: 2,
        firstRun: "2031-01-21",
        lastRun: "2031-01-23",
      }),
    );
    expect(shoes).toContainEqual(
      expect.objectContaining({
        id: "trainer-red",
        model: "Synthetic Cruiser 1",
        status: "active",
        retiredDate: null,
        mileage: 38.97,
        runs: 6,
      }),
    );
  });

  it("loads the reviewed pre-build Runs, which count toward their weeks' mileage", async () => {
    await importFixture();
    const client = await connect();
    const week = async (day: string) =>
      ((await callTool(client, "check_mileage_cap", { proposed_week_miles: 0, week: day })) as { week: unknown }).week;
    expect(await week("2031-01-13")).toEqual({
      start: "2031-01-13",
      end: "2031-01-19",
      miles: 2.6,
      previousWeekMiles: 4.6,
      cap: 5.06,
    });
  });

  it("loads each day's lift rows as one Strength Session, with an entry per exercise", async () => {
    await importFixture();
    const client = await connect();
    // A correction that changes nothing returns the session as stored. Until
    // the query tool exists, that's how a test can read one back.
    const session = async (id: number) =>
      ((await callTool(client, "update_strength_session", { id })) as { strengthSession: unknown }).strengthSession;
    expect(await session(1)).toEqual({
      id: 1,
      date: "2031-05-01",
      sessionType: "Lower",
      notes: null,
      entries: [
        { pattern: "Squat", exercise: "Goblet squat", load: 35, loadBasis: "total", sets: 3, repsPerSet: "10,10,10", notes: null },
        {
          pattern: "Hinge",
          exercise: "Romanian deadlift",
          load: 25,
          loadBasis: "per_hand",
          sets: 3,
          repsPerSet: "8,8,8",
          notes: "Slow eccentric",
        },
        { pattern: "Finisher", exercise: "Side plank", load: null, loadBasis: "bodyweight", sets: 2, repsPerSet: "30s,30s", notes: null },
      ],
    });
    expect(await session(2)).toMatchObject({ date: "2031-05-05", sessionType: "Upper", entries: [{ exercise: "Push-up" }, { exercise: "Lat pulldown" }] });
  });

  it("loads the Body-comp Scans, keeping the ECW/TBW ratio (which has no column) in the notes", async () => {
    await importFixture();
    const client = await connect();
    const scan = async (id: number) =>
      ((await callTool(client, "update_body_comp_scan", { id })) as { bodyCompScan: unknown }).bodyCompScan;
    expect(await scan(1)).toEqual({
      id: 1,
      date: "2031-02-01",
      weight: 172,
      skeletalMuscleMass: 78.5,
      bodyFatMass: null,
      bodyFatPercent: 19.2,
      bmi: null,
      totalBodyWater: null,
      leanBodyMass: null,
      visceralFatLevel: null,
      basalMetabolicRate: null,
      score: null,
      notes: "Morning scan; ECW/TBW: 0.381",
    });
    expect(await scan(2)).toMatchObject({ date: "2031-05-02", bodyFatMass: 30.2, bmi: 24.1, visceralFatLevel: 6, basalMetabolicRate: 1720, notes: "ECW/TBW: 0.379" });
  });

  it("loads the reviewed Daily Check-ins, rating sleep quality on the structure file's scale", async () => {
    await importFixture();
    const client = await connect();
    // A report that changes nothing returns the date's Check-in as stored.
    const checkIn = async (date: string) =>
      (await callTool(client, "log_check_in", { date })) as { status: string; checkIn: Record<string, unknown> };
    const tuesday = await checkIn("2031-01-21");
    expect(tuesday.status).toBe("updated");
    expect(tuesday.checkIn).toEqual({
      date: "2031-01-21",
      sleepHours: expect.closeTo(6 + 5 / 60, 6),
      sleepQuality: 2,
      restingHr: 58,
      leftKneePain: 2.5,
      rightKneePain: 0,
      energy: 5,
      motivation: 6,
      lifeStress: 6,
      bodyWeight: 171.4,
      notes: "Late night; work deadline; Body fat: 18.5%",
    });
    expect((await checkIn("2031-01-22")).checkIn).toMatchObject({ sleepHours: null, sleepQuality: 6, restingHr: null, notes: "Partial report" });
    expect((await checkIn("2031-01-23")).checkIn).toMatchObject({ sleepHours: 10, sleepQuality: 10 });
  });

  it("loads the Race Results from the race history, linked to their narratives' vault paths", async () => {
    await importFixture();
    const client = await connect();
    const { prs } = (await callTool(client, "list_prs")) as { prs: { distance: string; raceResult: unknown }[] };
    expect(prs).toEqual([
      {
        distance: "5K",
        raceResult: {
          id: 2,
          kind: "tune_up",
          date: "2031-05-10",
          name: "Synthetic Park 5K",
          distance: "5K",
          officialTime: "26:01",
          pace: "8:23/mi",
          conditions: "62°F, humid",
          avgHr: 172,
          placement: null,
          narrativePath: "Races/2031-05-10-synthetic-park-5k.md",
          notes: "Result: 26:01 net (chip) / 26:20 gun; Distance / Pace: 5K; ~8:23/mi",
        },
      },
      {
        distance: "Half Marathon",
        raceResult: expect.objectContaining({
          id: 1,
          kind: "a_race",
          date: "2031-04-12",
          name: "Synthetic City Half",
          officialTime: "2:05:03",
          pace: "9:33/mi",
          avgHr: 168,
          placement: "512/2040 overall",
          narrativePath: "Races/2031-04-12-synthetic-city-half.md",
        }),
      },
    ]);
  });

  it("warns where a legacy training_goal label disagrees with the Phase the record's date falls in, or isn't mapped", async () => {
    const report = await importFixture();
    expect(report.warnings.filter((w) => w.message.includes("training_goal"))).toEqual([
      {
        source: "data/runs.csv:11",
        message:
          'training_goal "Synthetic recovery" maps to 2031 Synthetic Off-season / Recovery, ' +
          "but 2031-05-10 falls in 2031 Synthetic Off-season / Base.",
      },
      {
        source: "data/lifts.csv:5",
        message: 'training_goal "Synthetic strength" isn\'t in the structure file\'s legacyLabels.',
      },
    ]);
  });

  it("verifies counts and totals against the archive's files, showing what didn't match", async () => {
    const report = await importFixture();
    const row = (measure: string, archive: number, imported: number) => ({
      measure,
      archive,
      imported,
      matches: archive === imported,
    });
    expect(report.verification).toEqual([
      row("Runs", 13, 12),
      row("Total miles", 56.77, 54.77),
      row("Miles in old-pair", 2.5, 2.5),
      row("Miles in trainer-blue", 8.1, 6.1),
      row("Miles in trainer-red", 38.97, 38.97),
      row("Miles in no Shoe", 7.2, 7.2),
      row("Strength Sessions", 2, 2),
      row("Strength Session entries", 5, 5),
      row("Body-comp Scans", 2, 2),
      row("Daily Check-ins", 4, 4),
      row("Race Results", 2, 2),
    ]);
  });

  it("wipes whatever D1 held before rebuilding it", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", {
      name: "Stray Program",
      kind: "bridge",
      startDate: "2040-01-01",
      endDate: "2040-01-31",
      phases: [{ name: "Stray", startDate: "2040-01-01", endDate: "2040-01-31" }],
    });
    await callTool(client, "add_shoe", { id: "stray-pair" });
    await importFixture();
    expect(await callToolExpectingError(client, "phase_for_date", { date: "2040-01-15" })).toMatch(/No Phase covers/);
    const { shoes } = (await callTool(client, "list_shoes", { includeRetired: true })) as { shoes: { id: string }[] };
    expect(shoes.map((s) => s.id)).toEqual(["old-pair", "trainer-blue", "trainer-red"]);
  });

  it("gives identical results when run twice", async () => {
    const client = await connect();
    const observe = async () => ({
      shoes: await callTool(client, "list_shoes", { includeRetired: true }),
      prs: await callTool(client, "list_prs"),
      sessions: [await callTool(client, "update_strength_session", { id: 1 }), await callTool(client, "update_strength_session", { id: 2 })],
      scans: [await callTool(client, "update_body_comp_scan", { id: 1 }), await callTool(client, "update_body_comp_scan", { id: 2 })],
      checkIn: await callTool(client, "log_check_in", { date: "2031-01-21" }),
      week: await callTool(client, "check_mileage_cap", { proposed_week_miles: 0, week: "2031-01-20" }),
      // A Run's id is stable too: the same correction finds the same Run.
      run: await callTool(client, "update_run", { id: 3 }),
    });
    const firstReport = await importFixture();
    const first = await observe();
    const secondReport = await importFixture();
    expect(secondReport).toEqual(firstReport);
    expect(await observe()).toEqual(first);
  });

  it("reports a record no Phase covers instead of dropping it silently", async () => {
    const report = await importFixture();
    expect(report.unresolved).toEqual([
      {
        record: "Run",
        source: "data/runs.csv:2",
        date: "2030-12-30",
        reason: expect.stringMatching(/No Phase covers 2030-12-30/),
      },
    ]);
  });

  it("adds a pair the Runs were worn in but the shoe log leaves out, retired on its last Run, and warns", async () => {
    const report = await importFixture();
    const client = await connect();
    const { shoes } = (await callTool(client, "list_shoes", { includeRetired: true })) as { shoes: unknown[] };
    expect(shoes).toContainEqual(
      expect.objectContaining({ id: "old-pair", model: null, status: "retired", retiredDate: "2031-04-20", mileage: 2.5 }),
    );
    expect(report.warnings).toContainEqual({
      source: "data/runs.csv:9",
      message: expect.stringMatching(/Shoe old-pair isn't in the shoe log/),
    });
  });
});
