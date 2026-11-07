import { beforeEach, describe, expect, it } from "vitest";
import { offSeason, offSeasonProgram, recoveryPhase } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All sessions here are synthetic.

beforeEach(resetDatabase);

const lowerSession = {
  date: "2026-11-04",
  sessionType: "Lower",
  notes: "Felt strong",
  entries: [
    {
      pattern: "Squat",
      exercise: "Goblet squat",
      load: 35,
      loadBasis: "per hand",
      sets: 3,
      repsPerSet: "10",
      notes: "Slow eccentric",
    },
    { pattern: "Hinge", exercise: "Single-leg RDL", sets: 3, repsPerSet: "8 each side" },
  ],
};

describe("log_strength_session", () => {
  it("records a session with one entry per exercise, attributed to its Phase and Program", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    const output = await callTool(client, "log_strength_session", lowerSession);
    expect(output).toEqual({
      strengthSession: {
        id: expect.any(Number),
        date: "2026-11-04",
        sessionType: "Lower",
        notes: "Felt strong",
        entries: [
          {
            pattern: "Squat",
            exercise: "Goblet squat",
            load: 35,
            loadBasis: "per hand",
            sets: 3,
            repsPerSet: "10",
            notes: "Slow eccentric",
          },
          {
            pattern: "Hinge",
            exercise: "Single-leg RDL",
            load: null,
            loadBasis: null,
            sets: 3,
            repsPerSet: "8 each side",
            notes: null,
          },
        ],
      },
      program: offSeasonProgram,
      phase: recoveryPhase,
    });
  });
});

describe("log_strength_session rejections", () => {
  it("rejects a session dated outside every Phase", async () => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await callToolExpectingError(client, "log_strength_session", { ...lowerSession, date: "2027-01-05" })).toMatch(
      /No Phase covers 2027-01-05/,
    );
  });

  it.each([
    ["no entries", { entries: [] }, /at least one exercise entry/],
    ["a negative load", { entries: [{ exercise: "Goblet squat", load: -5 }] }, /Entry 1's load must be at least 0/],
    ["zero sets", { entries: [{ exercise: "Goblet squat", sets: 0 }] }, /Entry 1's sets must be at least 1/],
    ["a blank exercise", { entries: [{ exercise: " " }] }, /Entry 1's exercise is required/],
  ])("rejects %s", async (_, change, error) => {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    expect(await callToolExpectingError(client, "log_strength_session", { ...lowerSession, ...change })).toMatch(error);
  });
});

describe("correcting and deleting a Strength Session", () => {
  async function logged() {
    const client = await connect();
    await callTool(client, "upsert_program", offSeason);
    const { strengthSession } = (await callTool(client, "log_strength_session", lowerSession)) as {
      strengthSession: { id: number };
    };
    return { client, id: strengthSession.id };
  }

  it("moves a session to another date, re-attributing it, and keeps what wasn't corrected", async () => {
    const { client, id } = await logged();
    const output = (await callTool(client, "update_strength_session", { id, date: "2026-11-18", notes: null })) as {
      strengthSession: { date: string; sessionType: string; notes: string | null; entries: unknown[] };
      phase: { name: string };
    };
    expect(output.strengthSession).toMatchObject({ id, date: "2026-11-18", sessionType: "Lower", notes: null });
    expect(output.strengthSession.entries).toHaveLength(2);
    expect(output.phase.name).toBe("Base");
  });

  it("replaces the whole list of entries", async () => {
    const { client, id } = await logged();
    const output = (await callTool(client, "update_strength_session", {
      id,
      entries: [{ pattern: "Push", exercise: "Push-up", loadBasis: "bodyweight", sets: 2, repsPerSet: "12" }],
    })) as { strengthSession: { entries: unknown[] } };
    expect(output.strengthSession.entries).toEqual([
      { pattern: "Push", exercise: "Push-up", load: null, loadBasis: "bodyweight", sets: 2, repsPerSet: "12", notes: null },
    ]);
  });

  it("rejects a correction to a date outside every Phase, leaving the session as it was", async () => {
    const { client, id } = await logged();
    expect(await callToolExpectingError(client, "update_strength_session", { id, date: "2027-01-05" })).toMatch(
      /No Phase covers 2027-01-05/,
    );
    const output = (await callTool(client, "update_strength_session", { id })) as { strengthSession: { date: string } };
    expect(output.strengthSession.date).toBe("2026-11-04");
  });

  it("deletes a session, after which it can't be corrected", async () => {
    const { client, id } = await logged();
    const output = (await callTool(client, "delete_strength_session", { id })) as { deleted: { id: number } };
    expect(output.deleted.id).toBe(id);
    expect(await callToolExpectingError(client, "update_strength_session", { id, notes: "x" })).toMatch(
      new RegExp(`There's no Strength Session ${id}`),
    );
    expect(await callToolExpectingError(client, "delete_strength_session", { id })).toMatch(/There's no Strength Session/);
  });
});
