import { beforeEach, describe, expect, it } from "vitest";
import { offSeason, offSeasonProgram, recoveryPhase } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All Check-ins here are synthetic.

beforeEach(resetDatabase);

const morning = {
  date: "2026-11-05",
  sleepHours: 7.5,
  sleepQuality: 4,
  restingHr: 52,
  leftKneePain: 1,
  rightKneePain: 0,
  energy: 4,
  motivation: 5,
  lifeStress: 2,
};

describe("log_check_in", () => {
  it("records a Daily Check-in attributed to its Phase, leaving unreported fields empty", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await callTool(client, "log_check_in", morning)).toEqual({
      status: "created",
      checkIn: { ...morning, bodyWeight: null, notes: null },
      program: offSeasonProgram,
      phase: recoveryPhase,
    });
  });

  it("updates the existing Check-in for the same date instead of creating a second one", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "log_check_in", morning);
    const later = await callTool(client, "log_check_in", {
      date: "2026-11-05",
      restingHr: 50,
      bodyWeight: 160.2,
      notes: null,
      energy: null,
    });
    expect(later).toMatchObject({
      status: "updated",
      checkIn: { ...morning, restingHr: 50, bodyWeight: 160.2, energy: null, notes: null },
    });

    // Only one Check-in exists for the date: one delete removes it.
    const deleted = await callTool(client, "delete_check_in", { date: "2026-11-05" });
    expect(deleted).toMatchObject({ deleted: { date: "2026-11-05", restingHr: 50 } });
    expect(await callToolExpectingError(client, "delete_check_in", { date: "2026-11-05" })).toMatch(
      /There's no Daily Check-in for 2026-11-05/,
    );
  });

  it("keeps Check-ins for different dates apart", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    await callTool(client, "log_check_in", morning);
    expect(await callTool(client, "log_check_in", { date: "2026-11-06", restingHr: 55 })).toMatchObject({
      status: "created",
      checkIn: { date: "2026-11-06", restingHr: 55, sleepHours: null },
    });
  });

  it("rejects a Check-in dated outside every Phase", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await callToolExpectingError(client, "log_check_in", { ...morning, date: "2027-01-05" })).toMatch(
      /No Phase covers 2027-01-05/,
    );
  });

  it.each([
    ["a pain rating above 10", { rightKneePain: 11 }, /rightKneePain must be between 0 and 10/],
    ["negative sleep", { sleepHours: -1 }, /sleepHours must be between 0 and 24/],
    ["a fractional resting HR", { restingHr: 51.5 }, /restingHr/],
  ])("rejects %s", async (_, change, error) => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await callToolExpectingError(client, "log_check_in", { ...morning, ...change })).toMatch(error);
  });
});
