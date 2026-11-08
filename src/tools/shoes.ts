import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { addShoe, DEFAULT_WARN_AT_MILES, listShoes, retireShoe, SHOE_STATUSES } from "../core/shoes";
import { date, structured } from "./shared";

/** The Shoe tools: adding, retiring and listing pairs of running shoes. */
export function registerShoeTools(server: McpServer, env: Env) {
  const db = env.DB;
  server.registerTool(
    "add_shoe",
    {
      title: "Add a Shoe",
      description:
        "Adds a new pair of running shoes, so Runs can be logged in it. Its mileage and first and last Run dates " +
        "are always worked out from its Runs.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The runner's identifier for the pair, e.g. trainer-blue. Runs name it as their shoe."),
        model: z.string().nullish().describe("The make and model, e.g. Synthetic Trainer 3"),
        notes: z.string().nullish(),
        warnAtMiles: z
          .number()
          .nullish()
          .describe(`The mileage at which to flag the pair as nearing replacement. Defaults to ${DEFAULT_WARN_AT_MILES}.`),
      }),
      outputSchema: z.object({ shoe: shoeSchema }),
    },
    async (input) => structured({ shoe: await addShoe(db, input) }),
  );

  server.registerTool(
    "retire_shoe",
    {
      title: "Retire a Shoe",
      description:
        "Retires a pair: it stops being listed as active, but its Runs and mileage stay. " +
        "Runs up to the retirement date can still be logged in it. Rejected if it has Runs after that date.",
      inputSchema: z.object({
        id: z.string().describe("The pair's identifier"),
        date: date("The day the pair was retired, usually today"),
      }),
      outputSchema: z.object({ shoe: shoeSchema }),
    },
    async ({ id, date }) => structured({ shoe: await retireShoe(db, id, date) }),
  );

  server.registerTool(
    "list_shoes",
    {
      title: "List Shoes",
      description: "The runner's pairs of running shoes with their mileage, flagging any nearing replacement.",
      inputSchema: z.object({
        includeRetired: z.boolean().optional().describe("true to include retired pairs. By default only active ones are listed."),
      }),
      outputSchema: z.object({ shoes: z.array(shoeSchema).describe("Sorted by identifier") }),
      annotations: { readOnlyHint: true },
    },
    async ({ includeRetired }) => structured({ shoes: await listShoes(db, { includeRetired }) }),
  );
}

export const shoeSchema = z.object({
  id: z.string(),
  model: z.string().nullable(),
  status: z.enum(SHOE_STATUSES),
  retiredDate: z.string().nullable(),
  notes: z.string().nullable(),
  mileage: z.number().describe("Total miles of the Runs worn in it"),
  runs: z.number().describe("How many Runs were worn in it"),
  firstRun: z.string().nullable().describe("The date of its first Run"),
  lastRun: z.string().nullable().describe("The date of its last Run"),
  warnAtMiles: z.number().describe("The mileage at which it's flagged as nearing replacement"),
  nearingReplacement: z
    .boolean()
    .describe("Whether its mileage has reached warnAtMiles. If so, tell the runner it's nearing its replacement window."),
});
