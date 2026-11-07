import { beforeEach, describe, expect, it } from "vitest";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All Programs, Runs and Shoes here are synthetic.

beforeEach(resetDatabase);

type Client = Awaited<ReturnType<typeof connect>>;

const fallBase = {
  name: "2026 Fall Base",
  kind: "bridge",
  startDate: "2026-10-05",
  endDate: "2026-12-27",
  phases: [{ name: "Base", startDate: "2026-10-05", endDate: "2026-12-27" }],
};

async function season(): Promise<Client> {
  const client = await connect();
  await callTool(client, "upsert_program", fallBase);
  return client;
}

describe("add_shoe", () => {
  it("adds a pair with no Runs yet, leaving missing fields empty", async () => {
    const client = await season();
    expect(await callTool(client, "add_shoe", { id: "trainer-blue", model: "Synthetic Trainer 3" })).toEqual({
      shoe: {
        id: "trainer-blue",
        model: "Synthetic Trainer 3",
        status: "active",
        retiredDate: null,
        notes: null,
        mileage: 0,
        runs: 0,
        firstRun: null,
        lastRun: null,
        warnAtMiles: 300,
        nearingReplacement: false,
      },
    });
  });

  it("rejects a second pair with the same identifier", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    expect(await callToolExpectingError(client, "add_shoe", { id: "trainer-blue" })).toMatch(/already a Shoe trainer-blue/);
  });

  it("rejects a non-positive replacement threshold", async () => {
    const client = await season();
    expect(await callToolExpectingError(client, "add_shoe", { id: "trainer-blue", warnAtMiles: 0 })).toMatch(
      /warnAtMiles must be more than 0/,
    );
  });
});

describe("Shoe mileage", () => {
  it("is derived from the Runs worn in it, with first and last Run dates", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    await callTool(client, "add_shoe", { id: "racer-red" });
    await callTool(client, "log_run", { date: "2026-11-10", distance: 4.2, shoe: "trainer-blue" });
    await callTool(client, "log_run", { date: "2026-11-03", distance: 3.1, shoe: "trainer-blue" });
    await callTool(client, "log_run", { date: "2026-11-05", distance: 5, shoe: "racer-red" });
    const output = await callTool(client, "log_run", { date: "2026-11-07", distance: 6.3, shoe: "trainer-blue" });
    expect(output.shoe).toMatchObject({ id: "trainer-blue", mileage: 13.6, runs: 3, firstRun: "2026-11-03", lastRun: "2026-11-10" });
  });

  it("is reported as null on a Run without a Shoe", async () => {
    const client = await season();
    const output = await callTool(client, "log_run", { date: "2026-11-03", distance: 3 });
    expect(output.shoe).toBeNull();
  });

  it("flags a pair nearing replacement once it reaches the default threshold", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    await callTool(client, "log_run", { date: "2026-10-10", distance: 299, shoe: "trainer-blue" });
    expect((await shoe(client, "trainer-blue")).nearingReplacement).toBe(false);
    const output = await callTool(client, "log_run", { date: "2026-10-11", distance: 1, shoe: "trainer-blue" });
    expect(output.shoe).toMatchObject({ mileage: 300, nearingReplacement: true });
  });

  it("flags a pair at its own threshold when one is set", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "racer-red", warnAtMiles: 150 });
    const output = await callTool(client, "log_run", { date: "2026-10-10", distance: 151, shoe: "racer-red" });
    expect(output.shoe).toMatchObject({ warnAtMiles: 150, nearingReplacement: true });
  });
});

describe("retire_shoe and list_shoes", () => {
  it("retires a pair: it leaves the active list but keeps its history", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    await callTool(client, "add_shoe", { id: "racer-red" });
    await callTool(client, "log_run", { date: "2026-11-03", distance: 3.1, shoe: "trainer-blue" });
    const output = await callTool(client, "retire_shoe", { id: "trainer-blue", date: "2026-11-04" });
    expect(output.shoe).toMatchObject({ status: "retired", retiredDate: "2026-11-04", mileage: 3.1, lastRun: "2026-11-03" });

    expect(ids(await callTool(client, "list_shoes"))).toEqual(["racer-red"]);
    expect(ids(await callTool(client, "list_shoes", { includeRetired: true }))).toEqual(["racer-red", "trainer-blue"]);
  });

  it("still takes Runs in a retired pair up to its retirement date, but not after", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    await callTool(client, "retire_shoe", { id: "trainer-blue", date: "2026-11-04" });
    await callTool(client, "log_run", { date: "2026-11-04", distance: 3, shoe: "trainer-blue" });
    expect(
      await callToolExpectingError(client, "log_run", { date: "2026-11-05", distance: 3, shoe: "trainer-blue" }),
    ).toMatch(/Shoe trainer-blue was retired on 2026-11-04/);
  });

  it("rejects retiring a pair before its last Run", async () => {
    const client = await season();
    await callTool(client, "add_shoe", { id: "trainer-blue" });
    await callTool(client, "log_run", { date: "2026-11-06", distance: 3, shoe: "trainer-blue" });
    expect(await callToolExpectingError(client, "retire_shoe", { id: "trainer-blue", date: "2026-11-05" })).toMatch(
      /trainer-blue has Runs up to 2026-11-06/,
    );
  });

  it("rejects retiring an unknown pair", async () => {
    expect(await callToolExpectingError(await season(), "retire_shoe", { id: "nope", date: "2026-11-05" })).toMatch(
      /There's no Shoe nope/,
    );
  });
});

async function shoe(client: Client, id: string): Promise<Record<string, unknown>> {
  const { shoes } = (await callTool(client, "list_shoes", { includeRetired: true })) as { shoes: { id: string }[] };
  return shoes.find((s) => s.id === id)!;
}

function ids(output: Record<string, unknown>): string[] {
  return (output.shoes as { id: string }[]).map((s) => s.id);
}
