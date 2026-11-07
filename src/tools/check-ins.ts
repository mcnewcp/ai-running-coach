import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteCheckIn, logCheckIn } from "../core/check-ins";
import { attributed, attribution, date, number, structured, text } from "./shared";

/** The Daily Check-in tools: the runner's morning wellness report, at most one per date. */
export function registerCheckInTools(server: McpServer, env: Env) {
  const db = env.DB;
  const rating = (what: string) => number(`${what}, 0-10`);
  const checkInSchema = z.object({
    date: z.string(),
    sleepHours: z.number().nullable(),
    sleepQuality: z.number().nullable(),
    restingHr: z.number().nullable(),
    leftKneePain: z.number().nullable(),
    rightKneePain: z.number().nullable(),
    energy: z.number().nullable(),
    motivation: z.number().nullable(),
    lifeStress: z.number().nullable(),
    bodyWeight: z.number().nullable(),
    notes: z.string().nullable(),
  });

  server.registerTool(
    "log_check_in",
    {
      title: "Log a Daily Check-in",
      description:
        "Records the runner's morning wellness report for one day. There's at most one Check-in per date: " +
        "if the date already has one, this updates it (status: updated). Fields you leave out keep their value, " +
        "so a later report only needs what's new or corrected; null clears a field. " +
        attribution,
      inputSchema: z.object({
        date: date("The day the Check-in is for"),
        sleepHours: number("Hours slept last night"),
        sleepQuality: rating("Sleep quality"),
        restingHr: z.number().int().nullish().describe("Resting heart rate, bpm"),
        leftKneePain: rating("Left knee pain"),
        rightKneePain: rating("Right knee pain"),
        energy: rating("Energy"),
        motivation: rating("Motivation"),
        lifeStress: rating("Life stress"),
        bodyWeight: number("Body weight, in the runner's usual unit"),
        notes: text("Anything else the runner mentioned"),
      }),
      outputSchema: z.object({
        status: z
          .enum(["created", "updated"])
          .describe("created: the date's first Check-in. updated: merged into the date's existing Check-in"),
        checkIn: checkInSchema,
        ...attributed,
      }),
    },
    async (input) => structured(await logCheckIn(db, input)),
  );

  server.registerTool(
    "delete_check_in",
    {
      title: "Delete a Daily Check-in",
      description:
        "Deletes the Daily Check-in for a date, e.g. one logged against the wrong day. To correct a field, use log_check_in instead. " +
        "Returns what was deleted.",
      inputSchema: z.object({ date: date("The day the Check-in is for") }),
      outputSchema: z.object({ deleted: checkInSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ date }) => structured(await deleteCheckIn(db, date)),
  );
}
