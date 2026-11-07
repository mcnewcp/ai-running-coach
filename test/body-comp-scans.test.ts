import { beforeEach, describe, expect, it } from "vitest";
import { offSeason, offSeasonProgram, recoveryPhase } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All scans here are synthetic.

beforeEach(resetDatabase);

type Client = Awaited<ReturnType<typeof connect>>;

const noMetrics = {
  weight: null,
  skeletalMuscleMass: null,
  bodyFatMass: null,
  bodyFatPercent: null,
  bmi: null,
  totalBodyWater: null,
  leanBodyMass: null,
  visceralFatLevel: null,
  basalMetabolicRate: null,
  score: null,
  notes: null,
};

async function withSeason(): Promise<Client> {
  const client = await connect();
  await callTool(client, "upsert_program", offSeason);
  return client;
}

describe("log_body_comp_scan", () => {
  it("records only the metrics given, attributed to the scan's Phase", async () => {
    const client = await withSeason();
    const output = await callTool(client, "log_body_comp_scan", {
      date: "2026-11-09",
      weight: 158.4,
      bodyFatPercent: 14.2,
    });
    expect(output).toEqual({
      bodyCompScan: { id: expect.any(Number), date: "2026-11-09", ...noMetrics, weight: 158.4, bodyFatPercent: 14.2 },
      program: offSeasonProgram,
      phase: recoveryPhase,
    });
  });

  it("rejects a scan dated outside every Phase", async () => {
    const client = await withSeason();
    expect(await callToolExpectingError(client, "log_body_comp_scan", { date: "2026-10-30", weight: 158 })).toMatch(
      /No Phase covers 2026-10-30/,
    );
  });

  it.each([
    ["a negative metric", { weight: -1 }, /weight must be at least 0/],
    ["a body-fat percentage over 100", { bodyFatPercent: 101 }, /bodyFatPercent must be between 0 and 100/],
    ["no metrics at all", { notes: "Forgot the printout" }, /at least one metric/],
  ])("rejects %s", async (_, change, error) => {
    const client = await withSeason();
    expect(await callToolExpectingError(client, "log_body_comp_scan", { date: "2026-11-09", ...change })).toMatch(error);
  });
});

describe("correcting and deleting a Body-comp Scan", () => {
  async function logged() {
    const client = await withSeason();
    const { bodyCompScan } = (await callTool(client, "log_body_comp_scan", {
      date: "2026-11-09",
      weight: 158.4,
      bodyFatPercent: 14.2,
    })) as { bodyCompScan: { id: number } };
    return { client, id: bodyCompScan.id };
  }

  it("corrects a metric and adds a missed one, keeping the rest", async () => {
    const { client, id } = await logged();
    const output = await callTool(client, "update_body_comp_scan", {
      id,
      date: "2026-11-20",
      bodyFatPercent: 14.5,
      skeletalMuscleMass: 72.1,
    });
    expect(output).toMatchObject({
      bodyCompScan: { id, date: "2026-11-20", weight: 158.4, bodyFatPercent: 14.5, skeletalMuscleMass: 72.1, bmi: null },
      phase: { name: "Base" },
    });
  });

  it("deletes a scan, after which it can't be corrected", async () => {
    const { client, id } = await logged();
    expect(await callTool(client, "delete_body_comp_scan", { id })).toMatchObject({ deleted: { id, weight: 158.4 } });
    expect(await callToolExpectingError(client, "update_body_comp_scan", { id, weight: 150 })).toMatch(
      new RegExp(`There's no Body-comp Scan ${id}`),
    );
  });
});
