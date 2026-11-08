import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteStrengthSession, logStrengthSession, updateStrengthSession } from "../core/strength-sessions";
import { attributed, attribution, date, id, number, structured, text } from "./shared";

/** The Strength Session tools: logging, correcting and deleting gym sessions, one entry per exercise. */
export function registerStrengthSessionTools(server: McpServer, env: Env) {
  const db = env.DB;
  const entryInput = z.object({
    pattern: text("The movement pattern, e.g. Squat, Hinge, Push, Pull, Carry, Core"),
    exercise: z.string().min(1).describe("The exercise, e.g. Goblet squat"),
    load: number("The load, in the runner's usual unit (e.g. lb). Omit for bodyweight-only work"),
    loadBasis: text('What the load means, e.g. "per hand", "total", "bodyweight", "band"'),
    sets: z.number().int().nullish().describe("How many sets"),
    repsPerSet: text('Reps in each set, as free text, e.g. "10", "8 each side", "30 s", "10/8/8"'),
    notes: text("Notes on this exercise"),
  });
  const entrySchema = z.object({
    pattern: z.string().nullable(),
    exercise: z.string(),
    load: z.number().nullable(),
    loadBasis: z.string().nullable(),
    sets: z.number().nullable(),
    repsPerSet: z.string().nullable(),
    notes: z.string().nullable(),
  });
  const strengthSessionSchema = z.object({
    id: z.number(),
    date: z.string(),
    sessionType: z.string().nullable(),
    notes: z.string().nullable(),
    entries: z.array(entrySchema).describe("One per exercise, in the order performed"),
  });
  const strengthSessionWrite = z.object({ strengthSession: strengthSessionSchema, ...attributed });

  server.registerTool(
    "log_strength_session",
    {
      title: "Log a Strength Session",
      description:
        "Records one completed gym session, with one entry per exercise performed (pattern, exercise, load, load basis, sets, reps per set, notes). " +
        attribution,
      inputSchema: z.object({
        date: date("The day of the session"),
        sessionType: text("e.g. Upper, Lower or Mix"),
        notes: text("Notes on the whole session"),
        entries: z.array(entryInput).describe("One per exercise, in the order performed"),
      }),
      outputSchema: strengthSessionWrite,
    },
    async (input) => structured(await logStrengthSession(db, input)),
  );

  server.registerTool(
    "update_strength_session",
    {
      title: "Correct a Strength Session",
      description:
        "Corrects a logged Strength Session. Fields you leave out keep their value; null clears one. " +
        "entries, if given, replaces the session's whole list of entries. " +
        attribution,
      inputSchema: z.object({
        id: id("Strength Session"),
        date: date("The corrected day of the session").optional(),
        sessionType: text("e.g. Upper, Lower or Mix"),
        notes: text("Notes on the whole session"),
        entries: z.array(entryInput).optional().describe("The whole corrected list of entries, in the order performed"),
      }),
      outputSchema: strengthSessionWrite,
    },
    async (input) => structured(await updateStrengthSession(db, input)),
  );

  server.registerTool(
    "delete_strength_session",
    {
      title: "Delete a Strength Session",
      description: "Deletes a Strength Session logged by mistake, with its entries. Returns what was deleted.",
      inputSchema: z.object({ id: id("Strength Session") }),
      outputSchema: z.object({ deleted: strengthSessionSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => structured(await deleteStrengthSession(db, id)),
  );
}
