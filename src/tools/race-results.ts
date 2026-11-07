import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteRaceResult, listPRs, logRaceResult, updateRaceResult } from "../core/race-results";
import { attributed, attribution, date, id, structured, text } from "./shared";

/** The Race Result tools: logging, correcting and deleting Race Results, and the PRs derived from them. */
export function registerRaceResultTools(server: McpServer, env: Env) {
  const db = env.DB;
  const raceFields = {
    pace: text('The official pace, e.g. "7:48/mi"'),
    conditions: text("Weather and course conditions"),
    avgHr: z.number().int().nullish().describe("Average heart rate, bpm"),
    placement: text('Free text, e.g. "12/340 overall, 2/25 age group"'),
    narrativePath: text(
      'The vault path of the race narrative, e.g. "Races/2027-04-11-synthetic-city-half.md". It may be written later.',
    ),
    notes: text("Anything else worth keeping"),
  };
  const name = z.string().describe("The race's name");
  const distance = z
    .string()
    .describe("The distance as named, e.g. 5K, 10K, Half Marathon, Marathon. PRs are per distance, so name it consistently");
  const officialTime = z.string().describe("The official (chip) time, H:MM:SS or M:SS, e.g. 1:42:05 or 21:30");
  const raceResultSchema = z.object({
    id: z.number(),
    kind: z
      .enum(["a_race", "tune_up"])
      .describe("a_race: the A-race a Program names (on the Program's last day, with the same name). tune_up: any other race"),
    date: z.string(),
    name: z.string(),
    distance: z.string(),
    officialTime: z.string().describe("H:MM:SS, or M:SS under an hour"),
    pace: z.string().nullable(),
    conditions: z.string().nullable(),
    avgHr: z.number().nullable(),
    placement: z.string().nullable(),
    narrativePath: z.string().nullable(),
    notes: z.string().nullable(),
  });
  const raceResultWrite = z.object({ raceResult: raceResultSchema, ...attributed });
  const raceKinds =
    "Whether it's an A-race or a Tune-up Race is derived: it's the A-race if a race-build Program names it, i.e. the Program ends on its date " +
    "and its A-race has the same name (ignoring case and surrounding spaces). So name the A-race's result as the Program names it. " +
    "A Tune-up Race stays inside whatever Phase it falls in.";

  server.registerTool(
    "log_race_result",
    {
      title: "Log a Race Result",
      description:
        "Records the official outcome of one race, linked to its narrative document. " + raceKinds + " " + attribution,
      inputSchema: z.object({ date: date("Race day"), name, distance, officialTime, ...raceFields }),
      outputSchema: raceResultWrite,
    },
    async (input) => structured(await logRaceResult(db, input)),
  );

  server.registerTool(
    "update_race_result",
    {
      title: "Correct a Race Result",
      description:
        "Corrects a logged Race Result, e.g. once official results are posted or the narrative is written. " +
        "Fields you leave out keep their value; null clears an optional one. " +
        raceKinds +
        " " +
        attribution,
      inputSchema: z.object({
        id: id("Race Result"),
        date: date("The corrected race day").optional(),
        name: name.optional(),
        distance: distance.optional(),
        officialTime: officialTime.optional(),
        ...raceFields,
      }),
      outputSchema: raceResultWrite,
    },
    async (input) => structured(await updateRaceResult(db, input)),
  );

  server.registerTool(
    "delete_race_result",
    {
      title: "Delete a Race Result",
      description: "Deletes a Race Result logged by mistake. Its narrative document is left alone. Returns what was deleted.",
      inputSchema: z.object({ id: id("Race Result") }),
      outputSchema: z.object({ deleted: raceResultSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => structured(await deleteRaceResult(db, id)),
  );

  server.registerTool(
    "list_prs",
    {
      title: "List PRs",
      description:
        "The runner's PRs, derived from Race Results: the fastest official time at each distance (the earlier race on a tie). " +
        "Distances match ignoring case and spaces.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        prs: z
          .array(z.object({ distance: z.string(), raceResult: raceResultSchema }))
          .describe("One per distance, sorted by distance"),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => structured(await listPRs(db)),
  );
}
