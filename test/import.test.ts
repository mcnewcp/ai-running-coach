import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type ArchiveSource, dumpStatements, rebuildStructuredRecord } from "../src/import";
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

/** The rows of a read-only query, through the query tool. */
async function query(client: Awaited<ReturnType<typeof connect>>, sql: string): Promise<unknown[][]> {
  return ((await callTool(client, "query", { sql })) as { rows: unknown[][] }).rows;
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

  it("links each Phase to the vault path of its Plan, where the structure file names one", async () => {
    await importFixture();
    const client = await connect();
    const planOf = async (date: string) =>
      ((await callTool(client, "phase_for_date", { date })) as { phase: { planPath: string | null } }).phase.planPath;
    expect(await planOf("2031-02-01")).toBe("Programs/2031-01-synthetic-spring-half/Plans/phase-1-base.md");
    expect(await planOf("2031-04-05")).toBeNull();
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
    expect(
      await query(
        client,
        `SELECT s.date, s.session_type, s.notes AS session_notes, e.pattern, e.exercise, e.load, e.load_basis, e.sets,
           e.reps_per_set, e.notes
         FROM strength_sessions s JOIN exercise_entries e ON e.session_id = s.id ORDER BY s.date, e.position`,
      ),
    ).toEqual([
      ["2031-05-01", "Lower", null, "Squat", "Goblet squat", 35, "total", 3, "10,10,10", null],
      ["2031-05-01", "Lower", null, "Hinge", "Romanian deadlift", 25, "per_hand", 3, "8,8,8", "Slow eccentric"],
      ["2031-05-01", "Lower", null, "Finisher", "Side plank", null, "bodyweight", 2, "30s,30s", null],
      ["2031-05-05", "Upper", null, "Horizontal push", "Push-up", null, "bodyweight", 3, "12,10,8", null],
      ["2031-05-05", "Upper", null, "Vertical pull", "Lat pulldown", 70, "total", 3, "10,10,10", null],
    ]);
  });

  it("loads the Body-comp Scans, keeping the ECW/TBW ratio (which has no column) in the notes", async () => {
    await importFixture();
    const client = await connect();
    expect(
      await query(
        client,
        `SELECT date, weight, skeletal_muscle_mass, body_fat_mass, body_fat_percent, bmi, total_body_water,
           lean_body_mass, visceral_fat_level, basal_metabolic_rate, score, notes
         FROM body_comp_scans ORDER BY date`,
      ),
    ).toEqual([
      ["2031-02-01", 172, 78.5, null, 19.2, null, null, null, null, null, null, "Morning scan; ECW/TBW: 0.381"],
      ["2031-05-02", 169.6, 79.1, 30.2, 17.8, 24.1, null, null, 6, 1720, null, "ECW/TBW: 0.379"],
    ]);
  });

  it("loads the reviewed Daily Check-ins, rating sleep quality on the structure file's scale", async () => {
    await importFixture();
    const client = await connect();
    expect(
      await query(
        client,
        `SELECT date, ROUND(sleep_hours * 60) AS sleep_minutes, sleep_quality, resting_hr, left_knee_pain,
           right_knee_pain, energy, motivation, life_stress, body_weight, notes
         FROM check_ins ORDER BY date`,
      ),
    ).toEqual([
      ["2031-01-20", 450, 8, 55, 1, 0, 7, 8, 3, null, null],
      ["2031-01-21", 365, 2, 58, 2.5, 0, 5, 6, 6, 171.4, "Late night; work deadline; Body fat: 18.5%"],
      ["2031-01-22", null, 6, null, null, null, null, null, null, null, "Partial report"],
      ["2031-01-23", 600, 10, 54, 0, 0, 8, 8, 2, null, null],
    ]);
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
    // What the coach sees agrees with the report's imported side.
    const client = await connect();
    expect(await query(client, "SELECT COUNT(*), ROUND(SUM(distance_miles), 2) FROM runs")).toEqual([[12, 54.77]]);
    expect(
      await query(
        client,
        `SELECT (SELECT COUNT(*) FROM strength_sessions), (SELECT COUNT(*) FROM exercise_entries),
           (SELECT COUNT(*) FROM body_comp_scans), (SELECT COUNT(*) FROM check_ins), (SELECT COUNT(*) FROM race_results)`,
      ),
    ).toEqual([[2, 5, 2, 4, 2]]);
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
    const tables = [
      "programs",
      "phases",
      "shoes",
      "runs",
      "strength_sessions",
      "exercise_entries",
      "body_comp_scans",
      "check_ins",
      "race_results",
    ];
    // Every row of every table, ids included.
    const everything = async () =>
      Promise.all(tables.map((table) => query(client, `SELECT * FROM ${table} ORDER BY 1`)));
    const firstReport = await importFixture();
    const first = await everything();
    const secondReport = await importFixture();
    expect(secondReport).toEqual(firstReport);
    expect(await everything()).toEqual(first);
    expect(first.every((rows) => rows.length > 0)).toBe(true);
  });

  it("dumps the rebuilt record as SQL that makes another D1 identical, as the remote target needs", async () => {
    const client = await connect();
    await importFixture();
    const everything = async () =>
      Promise.all(
        ["programs", "phases", "shoes", "runs", "strength_sessions", "exercise_entries", "body_comp_scans", "check_ins", "race_results"].map(
          (table) => query(client, `SELECT * FROM ${table} ORDER BY 1`),
        ),
      );
    const imported = await everything();
    const statements = await dumpStatements(env.DB);

    // Stand in for the remote D1: one holding something else entirely.
    await resetDatabase();
    await callTool(client, "add_shoe", { id: "stray-pair" });
    for (const statement of statements) await env.DB.prepare(statement).run();
    expect(await everything()).toEqual(imported);
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
