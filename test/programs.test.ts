import { beforeEach, describe, expect, it } from "vitest";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All Programs, Phases and races here are synthetic.

beforeEach(resetDatabase);

const offSeason = {
  name: "2026 Off-season",
  kind: "bridge",
  startDate: "2026-11-02",
  endDate: "2026-12-27",
  phases: [
    { name: "Recovery", startDate: "2026-11-02", endDate: "2026-11-15", focus: "Rest", mileageTarget: "10-15 mi/wk" },
    { name: "Base", startDate: "2026-11-16", endDate: "2026-12-27", focus: "Easy aerobic", mileageTarget: "15-20 mi/wk" },
  ],
};

describe("upsert_program", () => {
  it("creates a bridge Program with its Phases and returns the structure", async () => {
    const client = await connect();
    expect(await callTool(client, "upsert_program", offSeason)).toEqual({
      program: {
        name: "2026 Off-season",
        kind: "bridge",
        startDate: "2026-11-02",
        endDate: "2026-12-27",
        aRace: null,
        phases: [
          {
            name: "Recovery",
            kind: "training",
            startDate: "2026-11-02",
            endDate: "2026-11-15",
            focus: "Rest",
            mileageTarget: "10-15 mi/wk",
            planPath: null,
          },
          {
            name: "Base",
            kind: "training",
            startDate: "2026-11-16",
            endDate: "2026-12-27",
            focus: "Easy aerobic",
            mileageTarget: "15-20 mi/wk",
            planPath: null,
          },
        ],
      },
      adjusted: [],
    });
  });

  it("rejects a new Program without its Phases", async () => {
    const { phases: _, ...noPhases } = offSeason;
    expect(await callToolExpectingError(await connect(), "upsert_program", noPhases)).toMatch(/give its Phases/);
  });
});

const springHalf = {
  name: "2027 Spring Half",
  kind: "race_build",
  startDate: "2026-12-28",
  endDate: "2027-04-11",
  aRace: { name: "Synthetic City Half", date: "2027-04-11" },
  phases: [
    { name: "Base", startDate: "2026-12-28", endDate: "2027-02-07", focus: "Aerobic base", mileageTarget: "20-25 mi/wk" },
    { name: "Build", startDate: "2027-02-08", endDate: "2027-03-28", focus: "Threshold", mileageTarget: "25-30 mi/wk" },
    { name: "Taper", startDate: "2027-03-29", endDate: "2027-04-10", focus: "Freshen up", mileageTarget: "15-20 mi/wk" },
    { name: "Race", kind: "race", startDate: "2027-04-11", endDate: "2027-04-11" },
  ],
};

type Client = Awaited<ReturnType<typeof connect>>;

/** Calls phase_for_date and returns "Program / Phase". */
async function placement(client: Client, date: string): Promise<string> {
  const output = (await callTool(client, "phase_for_date", { date })) as {
    program: { name: string };
    phase: { name: string };
  };
  return `${output.program.name} / ${output.phase.name}`;
}

describe("phase_for_date", () => {
  it("resolves the Program and Phase for any date, including first and last days", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await placement(client, "2026-11-02")).toBe("2026 Off-season / Recovery");
    expect(await placement(client, "2026-11-15")).toBe("2026 Off-season / Recovery");
    expect(await placement(client, "2026-11-16")).toBe("2026 Off-season / Base");
    expect(await placement(client, "2026-12-27")).toBe("2026 Off-season / Base");
  });

  it("returns the full Program and Phase", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", springHalf);
    expect(await callTool(client, "phase_for_date", { date: "2027-04-11" })).toEqual({
      date: "2027-04-11",
      program: {
        name: "2027 Spring Half",
        kind: "race_build",
        startDate: "2026-12-28",
        endDate: "2027-04-11",
        aRace: { name: "Synthetic City Half", date: "2027-04-11" },
      },
      phase: { name: "Race", kind: "race", startDate: "2027-04-11", endDate: "2027-04-11", focus: null, mileageTarget: null, planPath: null },
    });
  });

  it("fails clearly for a date no Phase covers", async () => {
    const client = await connect();
    expect(await callToolExpectingError(client, "phase_for_date", { date: "2026-11-02" })).toMatch(
      /No Phase covers 2026-11-02. There are no Programs yet/,
    );
    await callTool(client, "upsert_program", offSeason);
    expect(await callToolExpectingError(client, "phase_for_date", { date: "2026-12-28" })).toMatch(
      /No Phase covers 2026-12-28. Programs cover 2026-11-02 to 2026-12-27/,
    );
  });

  it("rejects something that isn't a calendar date", async () => {
    const client = await connect();
    for (const date of ["2026-02-30", "11/02/2026", "2026-11-2"]) {
      expect(await callToolExpectingError(client, "phase_for_date", { date })).toMatch(/not a calendar date/);
    }
  });
});

describe("a Program's Phase layout", () => {
  const withPhases = (phases: unknown[]) => ({ ...offSeason, phases });
  const recovery = offSeason.phases[0]!;
  const base = offSeason.phases[1]!;

  it.each([
    ["a gap between Phases", [recovery, { ...base, startDate: "2026-11-17" }], /gap from 2026-11-16 to 2026-11-16, between Phases Recovery and Base/],
    ["an overlap between Phases", [recovery, { ...base, startDate: "2026-11-15" }], /Phases Recovery .* and Base .* would overlap/],
    ["an uncovered start", [{ ...recovery, startDate: "2026-11-03" }, base], /Nothing would cover 2026-11-02, the start of Program 2026 Off-season/],
    ["an uncovered end", [recovery, { ...base, endDate: "2026-12-20" }], /Nothing would cover 2026-12-21 to 2026-12-27, the end of Program/],
    ["a Phase outside the Program", [recovery, { ...base, endDate: "2027-01-03" }], /Phase Base .* falls outside Program 2026 Off-season/],
    ["no Phases", [], /needs at least one Phase/],
    ["two Phases with one name", [recovery, { ...base, name: "Recovery" }], /two Phases named Recovery/],
  ])("rejects %s", async (_, phases, error) => {
    const client = await connect();
    expect(await callToolExpectingError(client, "upsert_program", withPhases(phases))).toMatch(error);
    expect(await callToolExpectingError(client, "phase_for_date", { date: "2026-11-20" })).toMatch(/No Phase covers/);
  });
});

describe("race builds and bridges", () => {
  async function withOffSeason(): Promise<Client> {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    return client;
  }
  const [base, build, taper, race] = springHalf.phases as [object, object, object, object];

  it("accepts a race build that ends with a one-day Race Phase on its A-race day", async () => {
    const output = (await callTool(await withOffSeason(), "upsert_program", springHalf)) as {
      program: { aRace: unknown; phases: { name: string; kind: string }[] };
    };
    expect(output.program.aRace).toEqual({ name: "Synthetic City Half", date: "2027-04-11" });
    expect(output.program.phases.map((p) => `${p.name}:${p.kind}`)).toEqual([
      "Base:training",
      "Build:training",
      "Taper:training",
      "Race:race",
    ]);
  });

  it.each([
    ["without an A-race", { aRace: undefined }, /race build, so it needs an A-race/],
    [
      "whose A-race isn't on its last day",
      { aRace: { name: "Synthetic City Half", date: "2027-04-10" } },
      /ends 2027-04-11 and its A-race is 2027-04-10/,
    ],
    ["without a Race Phase", { phases: [base, build, { ...taper, endDate: "2027-04-11" }] }, /doesn't end with its Race Phase/],
    [
      "whose Race Phase lasts more than a day",
      { phases: [base, build, { ...taper, endDate: "2027-04-09" }, { ...race, startDate: "2027-04-10" }] },
      /doesn't end with its Race Phase/,
    ],
    [
      "whose Race Phase isn't last",
      {
        phases: [
          { ...base, endDate: "2027-02-06" },
          { ...race, startDate: "2027-02-07", endDate: "2027-02-07" },
          build,
          taper,
          { ...race, name: "Race day", kind: "training" },
        ],
      },
      /doesn't end with its Race Phase/,
    ],
  ])("rejects a race build %s", async (_, change, error) => {
    const client = await withOffSeason();
    expect(await callToolExpectingError(client, "upsert_program", { ...springHalf, ...change })).toMatch(error);
  });

  it("rejects a bridge Program with an A-race", async () => {
    const error = await callToolExpectingError(await connect(), "upsert_program", {
      ...offSeason,
      aRace: { name: "Synthetic 10K", date: "2026-12-27" },
    });
    expect(error).toMatch(/bridge Programs have no A-race/);
  });

  it("rejects a bridge Program with a Race Phase", async () => {
    const [recovery, base] = offSeason.phases as [object, object];
    const error = await callToolExpectingError(await connect(), "upsert_program", {
      ...offSeason,
      phases: [
        recovery,
        { ...base, endDate: "2026-12-26" },
        { name: "Race", kind: "race", startDate: "2026-12-27", endDate: "2026-12-27" },
      ],
    });
    expect(error).toMatch(/no A-race, so it can't have a Race Phase/);
  });
});

describe("Programs tiling the calendar", () => {
  it("accepts a new Program that starts the day after the last ends, or ends the day before the first starts", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", springHalf);
    await callTool(client, "upsert_program", offSeason);
    expect(await placement(client, "2026-12-27")).toBe("2026 Off-season / Base");
    expect(await placement(client, "2026-12-28")).toBe("2027 Spring Half / Base");
  });

  it("rejects a new Program that would leave a gap", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    const error = await callToolExpectingError(client, "upsert_program", shifted(springHalf, 1));
    expect(error).toMatch(/gap from 2026-12-28 to 2026-12-28, between Programs 2026 Off-season and 2027 Spring Half/);
    expect(await callToolExpectingError(client, "phase_for_date", { date: "2026-12-30" })).toMatch(/No Phase covers/);
  });

  it("rejects a new Program that would overlap another", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    const error = await callToolExpectingError(client, "upsert_program", shifted(springHalf, -1));
    expect(error).toMatch(/Programs 2026 Off-season .* and 2027 Spring Half .* would overlap/);
    expect(await placement(client, "2026-12-27")).toBe("2026 Off-season / Base");
  });
});

describe("changing windows re-attributes dates", () => {
  async function season(): Promise<Client> {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", springHalf);
    return client;
  }
  const [base, build, taper, race] = springHalf.phases as [object, object, object, object];

  it("when a Program's Phase layout is replaced", async () => {
    const client = await season();
    expect(await placement(client, "2027-02-20")).toBe("2027 Spring Half / Build");
    // An injury: Build is cut short and a Rehab Phase follows it.
    await callTool(client, "upsert_program", {
      ...springHalf,
      phases: [
        base,
        { ...build, endDate: "2027-02-14" },
        { name: "Rehab", startDate: "2027-02-15", endDate: "2027-03-07", focus: "Cross-training" },
        { ...build, name: "Rebuild", startDate: "2027-03-08", endDate: "2027-03-28" },
        taper,
        race,
      ],
    });
    expect(await placement(client, "2027-02-14")).toBe("2027 Spring Half / Build");
    expect(await placement(client, "2027-02-20")).toBe("2027 Spring Half / Rehab");
    expect(await placement(client, "2027-03-08")).toBe("2027 Spring Half / Rebuild");
  });

  it("when a Phase's window changes, moving its neighbour's edge with it", async () => {
    const client = await season();
    expect(await placement(client, "2027-02-10")).toBe("2027 Spring Half / Build");
    const output = await callTool(client, "upsert_phase", {
      program: "2027 Spring Half",
      name: "Base",
      startDate: "2026-12-28",
      endDate: "2027-02-14",
      moveNeighbours: true,
    });
    expect(windows(output.program)).toEqual([
      "Base 2026-12-28..2027-02-14 training Aerobic base",
      "Build 2027-02-15..2027-03-28 training Threshold",
      "Taper 2027-03-29..2027-04-10 training Freshen up",
      "Race 2027-04-11..2027-04-11 race null",
    ]);
    expect(await placement(client, "2027-02-10")).toBe("2027 Spring Half / Base");

    // And back again, stretching Build to meet it.
    await callTool(client, "upsert_phase", {
      program: "2027 Spring Half", name: "Base", startDate: "2026-12-28", endDate: "2027-01-31", moveNeighbours: true,
    });
    expect(await placement(client, "2027-02-01")).toBe("2027 Spring Half / Build");
  });

  it("when a Program's window changes, moving its neighbour and their edge Phases", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_program", {
      ...offSeason,
      endDate: "2027-01-03",
      phases: undefined,
      moveNeighbours: true,
    });
    expect(windows(output.program)).toEqual([
      "Recovery 2026-11-02..2026-11-15 training Rest",
      "Base 2026-11-16..2027-01-03 training Easy aerobic",
    ]);
    expect(output.adjusted).toHaveLength(1);
    const [neighbour] = output.adjusted as [{ name: string; startDate: string }];
    expect(neighbour).toMatchObject({ name: "2027 Spring Half", startDate: "2027-01-04" });
    expect(windows(neighbour)[0]).toBe("Base 2027-01-04..2027-02-07 training Aerobic base");
    expect(await placement(client, "2027-01-03")).toBe("2026 Off-season / Base");
    expect(await placement(client, "2027-01-04")).toBe("2027 Spring Half / Base");
  });

  it("when a race build's A-race moves, keeping the Race Phase on the A-race day", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_program", {
      ...springHalf,
      endDate: "2027-04-18",
      aRace: { name: "Synthetic City Half", date: "2027-04-18" },
      phases: undefined,
    });
    expect(windows(output.program).slice(-2)).toEqual([
      "Taper 2027-03-29..2027-04-17 training Freshen up",
      "Race 2027-04-18..2027-04-18 race null",
    ]);
    expect(await placement(client, "2027-04-11")).toBe("2027 Spring Half / Taper");
  });

  it("but not by moving a neighbouring race build's A-race day", async () => {
    const client = await season();
    await callTool(client, "upsert_program", shifted({ ...offSeason, name: "2027 Summer Bridge" }, 161));
    const error = await callToolExpectingError(client, "upsert_program", {
      name: "2027 Summer Bridge",
      kind: "bridge",
      startDate: "2027-04-10",
      endDate: "2027-06-06",
      moveNeighbours: true,
    });
    expect(error).toMatch(/would move the A-race day of Program 2027 Spring Half \(2027-04-11\)/);
  });

  it("but not by emptying a neighbour's edge Phase", async () => {
    const client = await season();
    const error = await callToolExpectingError(client, "upsert_program", {
      ...offSeason,
      endDate: "2027-02-07",
      phases: undefined,
      moveNeighbours: true,
    });
    expect(error).toMatch(/Program 2027 Spring Half would become 2027-02-08 to 2027-04-11, but then: Phase Base would have no days/);
    expect(await placement(client, "2027-01-15")).toBe("2027 Spring Half / Base");
  });
});

describe("moving a neighbour's edge needs moveNeighbours", () => {
  async function season(): Promise<Client> {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", springHalf);
    return client;
  }
  const longerBase = { program: "2027 Spring Half", name: "Base", startDate: "2026-12-28", endDate: "2027-02-14" };

  it("rejects a Phase change that would move another Phase, saying exactly what would move", async () => {
    const client = await season();
    const error = await callToolExpectingError(client, "upsert_phase", longerBase);
    expect(error).toMatch(/would move Phase Build's start from 2027-02-08 to 2027-02-15\b/);
    expect(error).toMatch(/moveNeighbours: true/);
    expect(await placement(client, "2027-02-10")).toBe("2027 Spring Half / Build");
  });

  it("applies the move with moveNeighbours, returning the moved Phases in adjusted", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_phase", { ...longerBase, moveNeighbours: true });
    expect(output.adjusted).toEqual([expect.objectContaining({ name: "Build", startDate: "2027-02-15", endDate: "2027-03-28" })]);
    expect(await placement(client, "2027-02-10")).toBe("2027 Spring Half / Base");
  });

  it("returns no adjusted Phases when nothing else moves", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_phase", { ...longerBase, endDate: "2027-02-07", focus: "Easy miles" });
    expect(output.adjusted).toEqual([]);
  });

  it("rejects a Program change that would move another Program, saying exactly what would move", async () => {
    const client = await season();
    const error = await callToolExpectingError(client, "upsert_program", { ...offSeason, endDate: "2027-01-03", phases: undefined });
    expect(error).toMatch(/would move Program 2027 Spring Half's start from 2026-12-28 to 2027-01-04/);
    expect(error).toMatch(/Phase Base \(2027 Spring Half\)'s start from 2026-12-28 to 2027-01-04/);
    expect(error).toMatch(/moveNeighbours: true/);
    expect(await placement(client, "2026-12-30")).toBe("2027 Spring Half / Base");
  });
});

describe("a structure change never strands a record", () => {
  async function season(): Promise<Client> {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", springHalf);
    return client;
  }

  it("rejects shrinking the first Program past records, saying how many of each and their dates", async () => {
    const client = await season();
    await callTool(client, "log_run", { date: "2026-11-03", distance: 3 });
    await callTool(client, "log_run", { date: "2026-11-04", distance: 2 });
    await callTool(client, "log_strength_session", { date: "2026-11-04", entries: [{ exercise: "Goblet squat" }] });
    await callTool(client, "log_check_in", { date: "2026-11-05", energy: 7 });
    await callTool(client, "log_run", { date: "2026-11-09", distance: 4 });
    const error = await callToolExpectingError(client, "upsert_program", { ...offSeason, startDate: "2026-11-09", phases: undefined });
    expect(error).toMatch(
      /would leave records dated outside every Phase: 2 Runs, 1 Strength Session, 1 Daily Check-in, from 2026-11-03 to 2026-11-05\./,
    );
    expect(await placement(client, "2026-11-03")).toBe("2026 Off-season / Recovery");
  });

  it("rejects cutting the calendar's last day past records", async () => {
    const client = await season();
    await callTool(client, "log_body_comp_scan", { date: "2027-04-08", weight: 150 });
    await callTool(client, "log_race_result", {
      date: "2027-04-11", name: "Synthetic City Half", distance: "Half Marathon", officialTime: "1:45:00",
    });
    const error = await callToolExpectingError(client, "upsert_program", {
      ...springHalf,
      endDate: "2027-04-04",
      aRace: { name: "Synthetic City Half", date: "2027-04-04" },
      phases: undefined,
    });
    expect(error).toMatch(/outside every Phase: 1 Body-comp Scan, 1 Race Result, from 2027-04-08 to 2027-04-11\./);
    expect(await placement(client, "2027-04-11")).toBe("2027 Spring Half / Race");
  });

  it("accepts the same change once no record would be stranded", async () => {
    const client = await season();
    await callTool(client, "log_run", { date: "2026-11-09", distance: 4 });
    await callTool(client, "upsert_program", { ...offSeason, startDate: "2026-11-09", phases: undefined });
    expect(await placement(client, "2026-11-09")).toBe("2026 Off-season / Recovery");
  });
});

describe("upsert_phase", () => {
  async function season(): Promise<Client> {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", springHalf);
    return client;
  }
  const change = (args: Record<string, unknown>) => ({ program: "2027 Spring Half", ...args });

  it("changes focus and mileage target, keeping what's omitted", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_phase", change({ name: "Build", startDate: "2027-02-08", endDate: "2027-03-28", mileageTarget: "28-32 mi/wk" }));
    expect((output.program as { phases: unknown[] }).phases[1]).toEqual({
      name: "Build",
      kind: "training",
      startDate: "2027-02-08",
      endDate: "2027-03-28",
      focus: "Threshold",
      mileageTarget: "28-32 mi/wk",
      planPath: null,
    });
  });

  it("adds a Phase at the edge of another, trimming it", async () => {
    const client = await season();
    const output = await callTool(client, "upsert_phase", change({ name: "Rehab", startDate: "2027-03-15", endDate: "2027-03-28", focus: "Cross-training", moveNeighbours: true }));
    expect(windows(output.program)).toEqual([
      "Base 2026-12-28..2027-02-07 training Aerobic base",
      "Build 2027-02-08..2027-03-14 training Threshold",
      "Rehab 2027-03-15..2027-03-28 training Cross-training",
      "Taper 2027-03-29..2027-04-10 training Freshen up",
      "Race 2027-04-11..2027-04-11 race null",
    ]);
    expect(await placement(client, "2027-03-20")).toBe("2027 Spring Half / Rehab");
  });

  it.each([
    ["swallow another Phase", { name: "Rehab", startDate: "2027-02-08", endDate: "2027-03-28" }, /Rehab .* would swallow Phase Build .* entirely/],
    ["split another Phase", { name: "Rehab", startDate: "2027-03-01", endDate: "2027-03-07" }, /Rehab .* would split Phase Build .* in two/],
    ["fall outside its Program", { name: "Base", startDate: "2026-12-21", endDate: "2027-02-07" }, /Phase Base .* falls outside Program 2027 Spring Half/],
    ["uncover the Program's first days", { name: "Base", startDate: "2027-01-04", endDate: "2027-02-07" }, /Nothing would cover 2026-12-28 to 2027-01-03, the start of Program/],
    ["move the Race Phase off the A-race day", { name: "Race", startDate: "2027-04-10", endDate: "2027-04-10" }, /Nothing would cover 2027-04-11, the end of Program/],
    ["make a second Race Phase", { name: "Taper", kind: "race", startDate: "2027-03-29", endDate: "2027-04-10" }, /doesn't end with its Race Phase/],
  ])("rejects a change that would %s", async (_, args, error) => {
    const client = await season();
    expect(await callToolExpectingError(client, "upsert_phase", change(args))).toMatch(error);
    expect(await placement(client, "2027-03-04")).toBe("2027 Spring Half / Build");
  });

  it("rejects a Phase for a Program that doesn't exist", async () => {
    const error = await callToolExpectingError(await connect(), "upsert_phase", change({ name: "Base", startDate: "2026-12-28", endDate: "2027-02-07" }));
    expect(error).toMatch(/no Program named 2027 Spring Half/);
  });
});

describe("a Phase's Plan", () => {
  const basePlan = "Programs/2026-12-spring-half/Plans/base.md";
  const buildPlan = "Programs/2026-12-spring-half/Plans/build.md";
  const withPlans = {
    ...springHalf,
    phases: springHalf.phases.map((phase) =>
      phase.name === "Base" ? { ...phase, planPath: basePlan } : phase.name === "Build" ? { ...phase, planPath: buildPlan } : phase,
    ),
  };
  const plans = (program: unknown) =>
    (program as { phases: { name: string; planPath: string | null }[] }).phases.map((p) => `${p.name}: ${p.planPath}`);

  it("is linked by vault path when the layout is given, and none by default", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    const { program } = await callTool(client, "upsert_program", withPlans);
    expect(plans(program)).toEqual([`Base: ${basePlan}`, `Build: ${buildPlan}`, "Taper: null", "Race: null"]);
    expect(await callTool(client, "phase_for_date", { date: "2027-01-10" })).toMatchObject({
      phase: { name: "Base", planPath: basePlan },
    });
  });

  it("is set, kept and cleared by upsert_phase", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", withPlans);
    const taperPlan = "Programs/2026-12-spring-half/Plans/taper.md";
    const set = await callTool(client, "upsert_phase", {
      program: "2027 Spring Half", name: "Taper", startDate: "2027-03-29", endDate: "2027-04-10", planPath: taperPlan,
    });
    expect(plans(set.program)).toContain(`Taper: ${taperPlan}`);
    const kept = await callTool(client, "upsert_phase", {
      program: "2027 Spring Half", name: "Base", startDate: "2026-12-28", endDate: "2027-02-14", moveNeighbours: true,
    });
    expect(plans(kept.program)).toEqual([`Base: ${basePlan}`, `Build: ${buildPlan}`, `Taper: ${taperPlan}`, "Race: null"]);
    const cleared = await callTool(client, "upsert_phase", {
      program: "2027 Spring Half", name: "Build", startDate: "2027-02-15", endDate: "2027-03-28", planPath: null,
    });
    expect(plans(cleared.program)).toContain("Build: null");
  });

  it("is kept for a same-named Phase when a new layout leaves it out, and cleared by null", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "upsert_program", withPlans);
    const relaid = await callTool(client, "upsert_program", {
      ...springHalf,
      phases: [
        { name: "Base", startDate: "2026-12-28", endDate: "2027-01-31" },
        { name: "Build", startDate: "2027-02-01", endDate: "2027-03-28", planPath: null },
        { name: "Taper", startDate: "2027-03-29", endDate: "2027-04-10" },
        { name: "Race", kind: "race", startDate: "2027-04-11", endDate: "2027-04-11" },
      ],
    });
    expect(plans(relaid.program)).toEqual([`Base: ${basePlan}`, "Build: null", "Taper: null", "Race: null"]);
  });

  it("must be a document path in the vault", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    for (const planPath of ["../outside.md", "Programs/plan.txt", "/Programs/plan.md"]) {
      const error = await callToolExpectingError(client, "upsert_phase", {
        program: "2026 Off-season", name: "Base", startDate: "2026-11-16", endDate: "2026-12-27", planPath,
      });
      expect(error).toMatch(/not a valid document path/);
    }
  });
});

/** A Program moved `days` later (earlier if negative), Phases and A-race included. */
function shifted<T extends { startDate: string; endDate: string; aRace?: { date: string }; phases: { startDate: string; endDate: string }[] }>(
  program: T,
  days: number,
): T {
  const move = (date: string) => {
    const moved = new Date(`${date}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    return moved.toISOString().slice(0, 10);
  };
  return {
    ...program,
    startDate: move(program.startDate),
    endDate: move(program.endDate),
    ...(program.aRace ? { aRace: { ...program.aRace, date: move(program.aRace.date) } } : {}),
    phases: program.phases.map((phase) => ({ ...phase, startDate: move(phase.startDate), endDate: move(phase.endDate) })),
  };
}

/** A Program's Phases as "name start..end kind focus" lines. */
function windows(program: unknown): string[] {
  const { phases } = program as {
    phases: { name: string; startDate: string; endDate: string; kind: string; focus: string | null }[];
  };
  return phases.map((p) => `${p.name} ${p.startDate}..${p.endDate} ${p.kind} ${p.focus}`);
}
