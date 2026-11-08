import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PHASE_KINDS, placeDate, PROGRAM_KINDS, upsertPhase, upsertProgram } from "../core/programs";
import { date, phaseSchema, programSchema, structured } from "./shared";

/** The structure tools: Programs and Phases, and which Phase a date falls in. */
export function registerProgramTools(server: McpServer, env: Env) {
  server.registerTool(
    "upsert_program",
    {
      title: "Create or change a Program",
      description:
        "Creates or changes a Program (matched by name) and, if given, its whole Phase layout. " +
        "Programs tile the calendar (each starts the day after the one before it ends), and Phases tile their Program. " +
        "A race build names its A-race and ends on that day with a one-day Race Phase; a bridge has neither. " +
        "A new Program must start the day after the last one ends (or end the day before the first starts). " +
        "Writes that would leave a gap or overlap, or leave a recorded Run, Strength Session, Check-in, scan or Race Result " +
        "dated outside every Phase (by shrinking the calendar's first or last Program), are rejected. " +
        "If changing an existing Program's window would move a neighbouring Program's edge, the write is rejected, naming exactly what would move, " +
        "unless you pass moveNeighbours: true (only once the runner has agreed). Then the Programs either side keep meeting it: " +
        "their adjoining edge, and the Phase on that edge, move with it, and they're returned in `adjusted`. " +
        "Records are never labelled with a Phase: they belong to whichever Phase their date falls in, so changing windows re-attributes them.",
      inputSchema: z.object({
        name: z.string().min(1).describe("The Program's name, e.g. 2027 Spring Half. It identifies the Program."),
        kind: z.enum(PROGRAM_KINDS).describe("race_build: builds to an A-race. bridge: between builds, e.g. an off-season."),
        startDate: date("The Program's first day"),
        endDate: date("The Program's last day. For a race build, its A-race day."),
        aRace: aRaceSchema
          .nullish()
          .describe("Race builds only: the A-race. Its date must be the Program's endDate."),
        phases: z
          .array(phaseInput)
          .optional()
          .describe(
            "The whole Phase layout, replacing any existing one. Required for a new Program. " +
              "Omit it to keep the existing Phases, with the first and last following the Program's new edges.",
          ),
        moveNeighbours,
      }),
      outputSchema: z.object({
        program: programSchema,
        adjusted: z.array(programSchema).describe("Neighbouring Programs whose windows moved to keep Programs tiling"),
      }),
    },
    async (input) => structured(await upsertProgram(env.DB, input)),
  );

  server.registerTool(
    "upsert_phase",
    {
      title: "Create or change a Phase",
      description:
        "Creates or changes one Phase (matched by name) of an existing Program, e.g. extending a Rehab Phase after an injury. " +
        "If the change would move a neighbouring Phase's edge, it's rejected, naming exactly what would move, unless you pass moveNeighbours: true. " +
        "Then the Phases either side keep meeting it: one it overlaps is trimmed, one that met its old window is stretched, " +
        "and the moved Phases are returned in `adjusted`. " +
        "Rejected if it would leave a gap or overlap, fall outside the Program, swallow or split another Phase, or break the Race Phase rule. " +
        "To restructure more than that, give the whole layout with upsert_program. Returns the whole Program. " +
        "Records belong to whichever Phase their date falls in, so this re-attributes them.",
      inputSchema: z.object({
        program: z.string().min(1).describe("The name of the Program the Phase belongs to"),
        name: z.string().min(1).describe("The Phase's name, e.g. Base. It identifies the Phase within its Program."),
        kind: z.enum(PHASE_KINDS).optional().describe("Omit to keep the current kind (training for a new Phase)"),
        startDate: date("The Phase's first day"),
        endDate: date("The Phase's last day"),
        focus: z.string().nullish().describe("Omit to keep the current focus; null clears it"),
        mileageTarget: z.string().nullish().describe("Free text, e.g. 20-25 mi/wk. Omit to keep it; null clears it"),
        planPath: planPath.describe(`${planPathMeaning} Omit to keep the current one; null clears it.`),
        moveNeighbours,
      }),
      outputSchema: z.object({
        program: programSchema,
        adjusted: z.array(phaseSchema).describe("Neighbouring Phases whose windows moved to keep Phases tiling"),
      }),
    },
    async (input) => structured(await upsertPhase(env.DB, input)),
  );

  server.registerTool(
    "phase_for_date",
    {
      title: "Phase for a date",
      description:
        "The Program and Phase a calendar date falls in. Every record belongs to the Phase its date falls in. " +
        "Fails if no Phase covers the date.",
      inputSchema: z.object({ date: date("The calendar date to look up") }),
      outputSchema: z.object({
        date: z.string(),
        program: programSchema.omit({ phases: true }),
        phase: phaseSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => structured(await placeDate(env.DB, date)),
  );
}

const planPathMeaning =
  "The vault path of the Phase's Plan, the document describing its intended training, " +
  'e.g. "Programs/2026-12-spring-half/Plans/base.md". get_coaching_context returns it for the active Phase. ' +
  "It may be written later.";
const planPath = z.string().nullish();

const moveNeighbours = z
  .boolean()
  .optional()
  .describe(
    "true to let this change move the shared edge of a neighbouring window to keep them tiling. " +
      "Without it, a change that would move a neighbour is rejected with what would move, so nothing moves by mistake.",
  );

const aRaceSchema = z.object({
  name: z.string().min(1).describe("The A-race's name"),
  date: date("The A-race day"),
});

const phaseInput = z.object({
  name: z.string().min(1).describe("The Phase's name, e.g. Base. Unique within its Program."),
  kind: z
    .enum(PHASE_KINDS)
    .optional()
    .describe("training (the default), or race: the one-day Race Phase on a race build's A-race day"),
  startDate: date("The Phase's first day"),
  endDate: date("The Phase's last day"),
  focus: z.string().nullish().describe("The Phase's single focus, e.g. Aerobic base"),
  mileageTarget: z.string().nullish().describe("Free text, e.g. 20-25 mi/wk"),
  planPath: planPath.describe(
    `${planPathMeaning} Omit to keep the Plan of the existing Phase with this name, if any; null clears it.`,
  ),
});
