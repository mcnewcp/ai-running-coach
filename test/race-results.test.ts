import { beforeEach, describe, expect, it } from "vitest";
import { offSeason, springHalf } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All races and results here are synthetic.

beforeEach(resetDatabase);

type Client = Awaited<ReturnType<typeof connect>>;
type RaceResult = { id: number; kind: string; officialTime: string; name: string; date: string };

async function withSeason(): Promise<Client> {
  const client = await connect();
  await callTool(client, "upsert_program", offSeason);
  await callTool(client, "upsert_program", springHalf);
  return client;
}

const turkeyTrot = {
  date: "2026-11-26",
  name: "Synthetic Turkey Trot",
  distance: "5K",
  officialTime: "21:30",
  pace: "6:55/mi",
  conditions: "Cold, 28F, light wind",
  avgHr: 172,
  placement: "15/400 overall",
  narrativePath: "Races/2026-11-26-synthetic-turkey-trot.md",
};

async function logRace(client: Client, race: Record<string, unknown>): Promise<RaceResult> {
  return ((await callTool(client, "log_race_result", race)) as { raceResult: RaceResult }).raceResult;
}

describe("log_race_result", () => {
  it("records a Tune-up Race inside whatever Phase it falls in", async () => {
    const client = await withSeason();
    expect(await callTool(client, "log_race_result", turkeyTrot)).toEqual({
      raceResult: { id: expect.any(Number), kind: "tune_up", ...turkeyTrot, notes: null },
      program: { name: "2026 Off-season", kind: "bridge", startDate: "2026-11-02", endDate: "2026-12-27", aRace: null },
      phase: {
        name: "Base",
        kind: "training",
        startDate: "2026-11-16",
        endDate: "2026-12-27",
        focus: "Easy aerobic",
        mileageTarget: "15-20 mi/wk",
        planPath: null,
      },
    });
  });

  it("shows a race on a Program's A-race day as that A-race, in the Race Phase", async () => {
    const client = await withSeason();
    const output = (await callTool(client, "log_race_result", {
      date: "2027-04-11",
      name: "Synthetic City Half",
      distance: "Half Marathon",
      officialTime: "1:42:05",
    })) as { raceResult: RaceResult; phase: { name: string }; program: { name: string } };
    expect(output.raceResult).toEqual({
      id: expect.any(Number),
      kind: "a_race",
      date: "2027-04-11",
      name: "Synthetic City Half",
      distance: "Half Marathon",
      officialTime: "1:42:05",
      pace: null,
      conditions: null,
      avgHr: null,
      placement: null,
      narrativePath: null,
      notes: null,
    });
    expect(output.phase.name).toBe("Race");
    expect(output.program.name).toBe("2027 Spring Half");
  });

  it("writes official times consistently", async () => {
    const client = await withSeason();
    expect((await logRace(client, { ...turkeyTrot, officialTime: "0:21:30" })).officialTime).toBe("21:30");
    expect((await logRace(client, { ...turkeyTrot, officialTime: "1:02:03.0" })).officialTime).toBe("1:02:03");
    expect((await logRace(client, { ...turkeyTrot, officialTime: "65:07" })).officialTime).toBe("1:05:07");
  });

  it("rejects a result dated outside every Phase", async () => {
    const client = await withSeason();
    expect(await callToolExpectingError(client, "log_race_result", { ...turkeyTrot, date: "2027-04-12" })).toMatch(
      /No Phase covers 2027-04-12/,
    );
  });

  it.each([
    ["a time that isn't one", { officialTime: "fast" }, /officialTime "fast" is not a time/],
    ["minutes over 59 after hours", { officialTime: "1:75:00" }, /officialTime "1:75:00" is not a time/],
    ["a zero time", { officialTime: "0:00" }, /officialTime must be more than zero/],
    ["a narrative outside the vault", { narrativePath: "../race.md" }, /not a valid document path/],
    ["a blank name", { name: " " }, /name is required/],
  ])("rejects %s", async (_, change, error) => {
    const client = await withSeason();
    expect(await callToolExpectingError(client, "log_race_result", { ...turkeyTrot, ...change })).toMatch(error);
  });
});

describe("correcting and deleting a Race Result", () => {
  it("corrects a result, re-deriving its kind and Phase from the new date", async () => {
    const client = await withSeason();
    const { id } = await logRace(client, { ...turkeyTrot, date: "2027-04-04" });
    const output = await callTool(client, "update_race_result", {
      id,
      date: "2027-04-11",
      officialTime: "21:10",
      placement: null,
    });
    expect(output).toMatchObject({
      raceResult: { id, kind: "a_race", date: "2027-04-11", officialTime: "21:10", placement: null, pace: "6:55/mi" },
      phase: { name: "Race" },
    });
  });

  it("deletes a result, after which it can't be corrected", async () => {
    const client = await withSeason();
    const { id } = await logRace(client, turkeyTrot);
    expect(await callTool(client, "delete_race_result", { id })).toMatchObject({ deleted: { id, name: turkeyTrot.name } });
    expect(await callToolExpectingError(client, "update_race_result", { id, notes: "x" })).toMatch(
      new RegExp(`There's no Race Result ${id}`),
    );
  });
});

describe("list_prs", () => {
  it("has no PRs before any Race Result", async () => {
    expect(await callTool(await withSeason(), "list_prs")).toEqual({ prs: [] });
  });

  it("derives the fastest Race Result at each distance", async () => {
    const client = await withSeason();
    await logRace(client, turkeyTrot);
    const faster5k = await logRace(client, {
      date: "2027-01-23",
      name: "Synthetic Winter 5K",
      distance: "5k",
      officialTime: "20:58",
    });
    await logRace(client, { date: "2027-03-06", name: "Synthetic Spring 5K", distance: "5K", officialTime: "21:05" });
    const half = await logRace(client, {
      date: "2027-04-11",
      name: "Synthetic City Half",
      distance: "Half Marathon",
      officialTime: "1:42:05",
    });

    expect(await callTool(client, "list_prs")).toEqual({
      prs: [
        { distance: "5k", raceResult: { ...faster5k } },
        { distance: "Half Marathon", raceResult: { ...half } },
      ],
    });
  });

  it("follows corrections and deletions", async () => {
    const client = await withSeason();
    const trot = await logRace(client, turkeyTrot);
    const winter = await logRace(client, {
      date: "2027-01-23",
      name: "Synthetic Winter 5K",
      distance: "5K",
      officialTime: "20:58",
    });
    const prName = async () =>
      ((await callTool(client, "list_prs")) as { prs: { raceResult: { name: string } }[] }).prs.map(
        (pr) => pr.raceResult.name,
      );
    expect(await prName()).toEqual(["Synthetic Winter 5K"]);
    await callTool(client, "update_race_result", { id: trot.id, officialTime: "20:40" });
    expect(await prName()).toEqual(["Synthetic Turkey Trot"]);
    await callTool(client, "delete_race_result", { id: trot.id });
    expect(await prName()).toEqual(["Synthetic Winter 5K"]);
    await callTool(client, "delete_race_result", { id: winter.id });
    expect(await prName()).toEqual([]);
  });

  it("keeps the earlier result when two tie", async () => {
    const client = await withSeason();
    await logRace(client, turkeyTrot);
    await logRace(client, { ...turkeyTrot, date: "2027-01-23", name: "Synthetic Winter 5K" });
    expect(await callTool(client, "list_prs")).toMatchObject({
      prs: [{ raceResult: { name: "Synthetic Turkey Trot" } }],
    });
  });
});
