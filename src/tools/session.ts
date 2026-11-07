import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WEEKDAYS } from "../core/calendar";
import { getCoachingContext, RECENT_RUN_DAYS, today } from "../core/session";
import { runSchema, weekStandingSchema } from "./runs";
import { phaseSchema, programSchema, structured } from "./shared";
import { shoeSchema } from "./shoes";

/** The session tools: what day it is, and what a coaching session starts from. */
export function registerSessionTools(server: McpServer, env: Env) {
  server.registerTool(
    "today",
    {
      title: "Today",
      description:
        "What day it is for the runner: today's local calendar date and weekday. " +
        "Call it instead of assuming the date. " +
        homeTimezoneRule,
      inputSchema: z.object({ timezone }),
      outputSchema: localDaySchema,
      annotations: { readOnlyHint: true },
    },
    async ({ timezone }) => structured(await today(env.DOCUMENTS, new Date(), timezone)),
  );

  server.registerTool(
    "get_coaching_context",
    {
      title: "Get the coaching context",
      description:
        "Call it at the start of every coaching session: everything the session starts from, in one call. " +
        "Today's date; the Runner Profile; the active Program (with its Phases) and Phase; the active Phase's Plan; " +
        "this Monday–Sunday week's miles so far and its Mileage Cap; " +
        `the Runs of the last ${RECENT_RUN_DAYS} days; and the active Shoes with their mileage. ` +
        "Missing pieces come back empty (null or []) rather than failing. " +
        homeTimezoneRule,
      inputSchema: z.object({ timezone }),
      outputSchema: z.object({
        today: localDaySchema,
        runnerProfile: z
          .object({
            path: z.string(),
            content: z.string().describe("The whole markdown document"),
            version: z.string().describe("Pass it to write_document as expected_version to update the Runner Profile"),
            properties: z
              .record(z.string(), z.string())
              .describe("The frontmatter's properties, e.g. timezone, the Home Timezone"),
          })
          .nullable()
          .describe("The Runner Profile: history, injuries, logistics. Null if the vault doesn't have one yet"),
        program: programSchema.nullable().describe("The Program today falls in, with its Phases; null if none covers today"),
        phase: phaseSchema.nullable().describe("The Phase today falls in; null if none covers today"),
        plan: z
          .object({ path: z.string(), content: z.string(), version: z.string() })
          .nullable()
          .describe(
            "The active Phase's Plan, the document at its planPath: read today's workout and the week's total from it. " +
              "Null if there's no active Phase, it links no Plan (link one with upsert_phase), or the Plan isn't written yet.",
          ),
        week: weekStandingSchema.describe(
          "This Monday–Sunday week's miles so far against its Mileage Cap. Weigh any change to the week against the cap.",
        ),
        recentRuns: z.array(runSchema).describe(`Runs in the ${RECENT_RUN_DAYS} days ending today, newest first`),
        shoes: z.array(shoeSchema).describe("Active Shoes with their mileage, sorted by identifier"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ timezone }) =>
      structured(await getCoachingContext({ db: env.DB, bucket: env.DOCUMENTS }, new Date(), timezone)),
  );
}

const homeTimezoneRule =
  "It uses the runner's Home Timezone (the timezone property of the Runner Profile) unless you pass the runner's " +
  "current timezone, e.g. while they're travelling, and reports which it used. " +
  "Fails if no timezone is passed and the Runner Profile has no valid one: never guess the day.";

const timezone = z
  .string()
  .optional()
  .describe(
    "The runner's current IANA timezone (e.g. Europe/London), when you know they're away from home. " +
      "Omit it to use the Home Timezone. Abbreviations like CST are rejected.",
  );

const localDaySchema = z.object({
  date: z.string().describe("ISO 8601 calendar date, e.g. 2026-09-24"),
  weekday: z.enum(WEEKDAYS),
  timezone: z.string().describe("The IANA timezone the date is local to"),
  timezoneSource: z.enum(["home", "given"]).describe("home: the Home Timezone. given: the timezone you passed"),
});
