import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { PHASE_KINDS, placeDate, PROGRAM_KINDS, upsertPhase, upsertProgram } from "./core/programs";
import { listDocuments, readDocument, writeDocument } from "./core/documents";
import { DomainError } from "./core/errors";
import { deleteBodyCompScan, logBodyCompScan, updateBodyCompScan } from "./core/body-comp-scans";
import { deleteCheckIn, logCheckIn } from "./core/check-ins";
import { deleteRaceResult, listPRs, logRaceResult, updateRaceResult } from "./core/race-results";
import { deleteStrengthSession, logStrengthSession, updateStrengthSession } from "./core/strength-sessions";
import { registerQueryTools } from "./tools/query";
import { registerRunTools } from "./tools/runs";
import { registerSessionTools } from "./tools/session";
import { date, phaseSchema, programSchema, structured } from "./tools/shared";
import { registerShoeTools } from "./tools/shoes";

/**
 * The MCP tools. Each is a thin wrapper over the domain core, named in the
 * domain language (CONTEXT.md).
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "ai-running-coach", version: "0.1.0" });
  registerSessionTools(server, env);

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
  registerRunTools(server, env);
  registerShoeTools(server, env.DB);
  registerDocumentTools(server, env.DOCUMENTS);
  registerOtherRecordTools(server, env.DB);
  registerQueryTools(server, env.DB);

  return server;
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

/**
 * The documents tools: the Athlete Record's markdown documents in R2 (Runner
 * Profile, Plans, Logs, race narratives), laid out as the runner's Obsidian
 * vault.
 */
function registerDocumentTools(server: McpServer, bucket: R2Bucket) {
  const vaultLayout =
    'The vault layout: "Runner Profile.md"; "Programs/<YYYY-MM-name>/Plans/…" and ' +
    '"Programs/<YYYY-MM-name>/Logs/…"; "Races/<YYYY-MM-DD>-<race>.md"; "Resources/…".';
  const path = z
    .string()
    .describe('The document\'s path in the vault, ending in .md, e.g. "Programs/2026-01-base/Plans/week-01.md".');
  const version = z.string().describe("The document's version. Pass it to write_document to update the document.");

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: `Lists the runner's markdown documents whose paths start with a prefix, sorted by path. ${vaultLayout}`,
      inputSchema: z.object({
        prefix: z
          .string()
          .optional()
          .describe('A path prefix, e.g. "Programs/2026-01-base/Logs/". Omit it to list the whole vault.'),
      }),
      outputSchema: z.object({
        prefix: z.string(),
        documents: z.array(z.object({ path: z.string(), version: z.string() })),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ prefix = "" }) => structured({ prefix, documents: await listDocuments(bucket, prefix) }),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read document",
      description:
        "Reads one of the runner's markdown documents (Runner Profile, Plan, Log, race narrative, resource). " +
        `Returns its content and version. Read a document before you update it. ${vaultLayout}`,
      inputSchema: z.object({ path }),
      outputSchema: z.object({ path: z.string(), content: z.string(), version }),
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => structured(await readDocument(bucket, path)),
  );

  server.registerTool(
    "write_document",
    {
      title: "Write document",
      description:
        "Writes one of the runner's markdown documents, replacing its whole content. The runner may edit " +
        "documents in Obsidian at any time, so a write never overwrites a change you haven't seen. " +
        "To update a document, pass the version you read as expected_version. To create one, pass create_only: true. " +
        'If the document changed since you read it (or already exists, when creating), nothing is written and status is "conflict", ' +
        "with the current content and version: merge your change into that content and write again with that version. " +
        vaultLayout,
      inputSchema: z.object({
        path,
        content: z.string().describe("The document's whole new markdown content."),
        create_only: z
          .boolean()
          .optional()
          .describe("true to create a new document. The write fails if one already exists at the path."),
        expected_version: z
          .string()
          .optional()
          .describe("To update a document: the version you read it at. The write fails if it changed since."),
      }),
      outputSchema: z.object({
        status: z
          .enum(["written", "conflict"])
          .describe("written: the document was written. conflict: nothing was written; see content and version"),
        path: z.string(),
        version: z
          .string()
          .nullable()
          .describe("written: the new version. conflict: the current version, or null if there's no document"),
        content: z
          .string()
          .nullable()
          .optional()
          .describe("conflict only: the current content, or null if there's no document"),
        message: z.string().optional().describe("conflict only: what happened"),
      }),
    },
    async ({ path, content, create_only, expected_version }) => {
      const creating = create_only === true;
      if (creating === (expected_version !== undefined)) {
        throw new DomainError(
          "Pass exactly one of create_only: true (to create a new document) or " +
            "expected_version (to update one, with the version you read).",
        );
      }
      const condition = creating ? { createOnly: true as const } : { expectedVersion: expected_version! };
      return structured(await writeDocument(bucket, { path, content, condition }));
    },
  );
}

/**
 * The tools for the other recorded sessions and measurements: Strength
 * Sessions, Daily Check-ins, Body-comp Scans and Race Results. Each belongs to
 * the Phase its date falls in, so writes return that Phase and its Program.
 */
function registerOtherRecordTools(server: McpServer, db: D1Database) {
  const attribution =
    "Records are never labelled with a Phase: the write returns the Program and Phase the date falls in, " +
    "and is rejected if no Phase covers it. Leave out anything the runner didn't report: it stays empty.";
  const attributed = {
    program: programSchema.omit({ phases: true }).describe("The Program the record's date falls in"),
    phase: phaseSchema.describe("The Phase the record's date falls in"),
  };
  const id = (noun: string) => z.number().int().describe(`The ${noun}'s id, as returned when it was logged`);
  const text = (description: string) => z.string().nullish().describe(description);
  const number = (description: string) => z.number().nullish().describe(description);

  // --- Strength Sessions ---

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

  // --- Daily Check-ins ---

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

  // --- Body-comp Scans ---

  const metrics = {
    weight: number("Weight, in the runner's usual unit (e.g. lb)"),
    skeletalMuscleMass: number("Skeletal muscle mass, same unit as weight"),
    bodyFatMass: number("Body fat mass, same unit as weight"),
    bodyFatPercent: number("Percent body fat, 0-100"),
    bmi: number("Body mass index"),
    totalBodyWater: number("Total body water, as printed"),
    leanBodyMass: number("Lean body mass, same unit as weight"),
    visceralFatLevel: number("Visceral fat level"),
    basalMetabolicRate: number("Basal metabolic rate, kcal"),
    score: number("The scan's overall score, if the printout gives one"),
    notes: text("Anything else worth keeping from the printout"),
  };
  const bodyCompScanSchema = z.object({
    id: z.number(),
    date: z.string(),
    weight: z.number().nullable(),
    skeletalMuscleMass: z.number().nullable(),
    bodyFatMass: z.number().nullable(),
    bodyFatPercent: z.number().nullable(),
    bmi: z.number().nullable(),
    totalBodyWater: z.number().nullable(),
    leanBodyMass: z.number().nullable(),
    visceralFatLevel: z.number().nullable(),
    basalMetabolicRate: z.number().nullable(),
    score: z.number().nullable(),
    notes: z.string().nullable(),
  });
  const bodyCompScanWrite = z.object({ bodyCompScan: bodyCompScanSchema, ...attributed });

  server.registerTool(
    "log_body_comp_scan",
    {
      title: "Log a Body-comp Scan",
      description:
        "Records one body-composition scan. Give only the metrics the printout shows: never estimate or derive the others. " +
        attribution,
      inputSchema: z.object({ date: date("The day of the scan"), ...metrics }),
      outputSchema: bodyCompScanWrite,
    },
    async (input) => structured(await logBodyCompScan(db, input)),
  );

  server.registerTool(
    "update_body_comp_scan",
    {
      title: "Correct a Body-comp Scan",
      description:
        "Corrects a logged Body-comp Scan. Fields you leave out keep their value; null clears one. " + attribution,
      inputSchema: z.object({
        id: id("Body-comp Scan"),
        date: date("The corrected day of the scan").optional(),
        ...metrics,
      }),
      outputSchema: bodyCompScanWrite,
    },
    async (input) => structured(await updateBodyCompScan(db, input)),
  );

  server.registerTool(
    "delete_body_comp_scan",
    {
      title: "Delete a Body-comp Scan",
      description: "Deletes a Body-comp Scan logged by mistake. Returns what was deleted.",
      inputSchema: z.object({ id: id("Body-comp Scan") }),
      outputSchema: z.object({ deleted: bodyCompScanSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => structured(await deleteBodyCompScan(db, id)),
  );

  // --- Race Results ---

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

/** The MCP API: the Worker's `/mcp` route, behind OAuth (src/auth). Tests call it directly. */
export const mcpApi = {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
