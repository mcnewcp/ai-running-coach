import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteRun, logRun, updateRun } from "../core/runs";
import { checkProposedWeek } from "../core/session";
import { date, phaseSchema, programSchema, structured } from "./shared";
import { shoeSchema } from "./shoes";

/** The Run tools: logging, correcting and deleting Runs. */
export function registerRunTools(server: McpServer, env: Env) {
  const db = env.DB;
  server.registerTool(
    "log_run",
    {
      title: "Log a Run",
      description:
        "Records one completed Run. Its Phase and Program are worked out from its date, never given. " +
        "Leave out anything the runner didn't report (e.g. VO2 max on a treadmill): it stays empty. " +
        "Rejected if no Phase covers the date, the Shoe is unknown or was retired before the Run's date, or the distance isn't positive.",
      inputSchema: z.object(runFields),
      outputSchema: runWriteSchema,
    },
    async (input) => structured(await logRun(db, input)),
  );

  server.registerTool(
    "update_run",
    {
      title: "Correct a Run",
      description:
        "Corrects a logged Run, e.g. a wrong distance, Shoe or date. Give only the fields to change: " +
        "omitted fields are kept, and null clears an optional one. Its Phase and Program follow its date. " +
        "The same rules as log_run apply. Also returns the week and Shoe the Run moved out of, if it did.",
      inputSchema: z.object({
        id: runId,
        ...runFields,
        date: runFields.date.optional(),
        distance: runFields.distance.optional(),
      }),
      outputSchema: runWriteSchema.extend({
        movedFrom: z.object({
          week: weekStandingSchema.nullable().describe("The week the Run moved out of, now without it; null if it stayed in its week"),
          shoe: shoeSchema.nullable().describe("The Shoe the Run was taken off, now without it; null if its Shoe didn't change"),
        }),
      }),
    },
    async (input) => structured(await updateRun(db, input)),
  );

  server.registerTool(
    "delete_run",
    {
      title: "Delete a Run",
      description:
        "Deletes a Run logged by mistake, e.g. a duplicate. Returns the deleted Run, and its week and Shoe as they stand without it.",
      inputSchema: z.object({ id: runId }),
      outputSchema: z.object({
        deleted: runSchema.describe("The deleted Run"),
        ...runEffects,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => structured(await deleteRun(db, id)),
  );

  server.registerTool(
    "check_mileage_cap",
    {
      title: "Check the Mileage Cap",
      description:
        "Whether a proposed week's mileage exceeds that week's Mileage Cap: the previous Monday–Sunday week's actual miles × 1.10. " +
        "Check it whenever a week's mileage is set or changed, in a Plan or in chat. It never blocks anything: " +
        "if the proposal exceeds the cap, tell the runner plainly (proposed vs. cap) and ask them to confirm. The decision is theirs. " +
        "Omit week for this week, worked out in the runner's Home Timezone, or in timezone if you pass their current one while they're away.",
      inputSchema: z.object({
        proposed_week_miles: z.number().describe("The week's total miles as proposed, including miles already run"),
        week: date("Any day of the Monday–Sunday week to check")
          .optional()
          .describe("Any day of the Monday–Sunday week to check, YYYY-MM-DD. Omit it for this week."),
        timezone: z
          .string()
          .optional()
          .describe(
            "Only used to find this week when week is omitted: the runner's current IANA timezone, when they're away from home. " +
              "Omit it to use the Home Timezone from the Runner Profile.",
          ),
      }),
      outputSchema: z.object({
        week: weekStandingSchema,
        cap: z.number().describe("The week's Mileage Cap, miles"),
        proposed: z.number().describe("The proposed week's miles"),
        exceeds: z.boolean().describe("Whether the proposal is over the cap. Exactly at the cap is within it."),
        delta: z.number().describe("proposed − cap: positive when over, negative when under"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ proposed_week_miles, week, timezone }) =>
      structured(
        await checkProposedWeek({ db, bucket: env.DOCUMENTS }, new Date(), proposed_week_miles, { week, timezone }),
      ),
  );
}

export const weekStandingSchema = z
  .object({
    start: z.string().describe("The week's Monday"),
    end: z.string().describe("The week's Sunday"),
    miles: z.number().describe("Miles recorded in the week so far"),
    previousWeekMiles: z.number().describe("Miles recorded in the week before, which sets the cap"),
    cap: z.number().describe("The week's Mileage Cap: previousWeekMiles × 1.10"),
  })
  .describe("Where a Monday–Sunday week stands against its Mileage Cap");

const runFields = {
  date: date("The day of the Run, where the runner was"),
  distance: z.number().describe("Miles, e.g. 3.1"),
  type: z.string().nullish().describe("The kind of Run, e.g. Easy, Long, Tempo, Intervals, Treadmill"),
  duration: z.string().nullish().describe("Moving time, h:mm:ss or m:ss, e.g. 1:05:30 or 27:45. Pace is derived from it."),
  avgHr: z.number().nullish().describe("Average heart rate, bpm"),
  vo2Max: z.number().nullish().describe("The watch's VO2 max estimate"),
  shoe: z.string().nullish().describe("The identifier of the Shoe worn, as given to add_shoe"),
  leftKneePain: z.number().nullish().describe("Left knee pain, 0-10"),
  rightKneePain: z.number().nullish().describe("Right knee pain, 0-10"),
  notes: z.string().nullish().describe("The runner's notes"),
};

export const runSchema = z.object({
  id: z.number().describe("Identifies the Run for update_run and delete_run"),
  date: z.string(),
  type: z.string().nullable(),
  distance: z.number().describe("Miles"),
  duration: z.string().nullable().describe("h:mm:ss, or m:ss under an hour"),
  pace: z.string().nullable().describe("Per mile, m:ss, derived from distance and duration"),
  avgHr: z.number().nullable(),
  vo2Max: z.number().nullable(),
  shoe: z.string().nullable(),
  leftKneePain: z.number().nullable(),
  rightKneePain: z.number().nullable(),
  notes: z.string().nullable(),
});

const runId = z.number().int().describe("The Run's id, as returned when it was logged");

const runEffects = {
  week: weekStandingSchema.describe(
    "Where the Run's week stands against its Mileage Cap after this write. Report it (e.g. 14.1 of 14.3); don't lecture about miles already run.",
  ),
  shoe: shoeSchema
    .nullable()
    .describe("The Run's Shoe with its mileage after this write, or null if it has none. Mention it if nearingReplacement."),
};

const runWriteSchema = z.object({
  run: runSchema,
  program: programSchema.omit({ phases: true }).describe("The Program the Run's date falls in"),
  phase: phaseSchema.describe("The Phase the Run's date falls in"),
  ...runEffects,
});
