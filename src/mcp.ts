import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { today, WEEKDAYS } from "./core/calendar";
import { PHASE_KINDS, placeDate, PROGRAM_KINDS, upsertPhase, upsertProgram } from "./core/programs";
import { listDocuments, readDocument, writeDocument } from "./core/documents";
import { DomainError } from "./core/errors";

/**
 * The MCP tools. Each is a thin wrapper over the domain core, named in the
 * domain language (CONTEXT.md).
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "ai-running-coach", version: "0.1.0" });

  server.registerTool(
    "today",
    {
      title: "Today",
      description:
        "What day it is for the runner: today's local calendar date and weekday. " +
        "Call it instead of assuming the date. It uses the runner's Home Timezone unless you pass " +
        "the runner's current timezone, e.g. while they're travelling.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            "The runner's current IANA timezone (e.g. Europe/London), when you know they're away from home. " +
              "Omit it to use the Home Timezone. Abbreviations like CST are rejected.",
          ),
      }),
      outputSchema: z.object({
        date: z.string().describe("ISO 8601 calendar date, e.g. 2026-09-24"),
        weekday: z.enum(WEEKDAYS),
        timezone: z.string().describe("The IANA timezone the date is local to"),
        timezoneSource: z
          .enum(["home", "given"])
          .describe("home: the Home Timezone. given: the timezone you passed"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ timezone }) => structured(today(new Date(), timezone)),
  );

  server.registerTool(
    "upsert_program",
    {
      title: "Create or change a Program",
      description:
        "Creates or changes a Program (matched by name) and, if given, its whole Phase layout. " +
        "Programs tile the calendar (each starts the day after the one before it ends), and Phases tile their Program. " +
        "A race build names its A-race and ends on that day with a one-day Race Phase; a bridge has neither. " +
        "A new Program must start the day after the last one ends (or end the day before the first starts). " +
        "If an existing Program's window changes, the Programs either side keep meeting it: their adjoining edge, and the Phase on that edge, " +
        "move with it, and they're returned in `adjusted`. Writes that would leave a gap or overlap are rejected. " +
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
        "The Phases either side keep meeting it: one it overlaps is trimmed, and one that met its old window is stretched. " +
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
      }),
      outputSchema: z.object({ program: programSchema }),
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
  registerDocumentTools(server, env.DOCUMENTS);

  return server;
}

function date(description: string) {
  return z.string().describe(`${description}: a local calendar date, YYYY-MM-DD`);
}

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
});

const phaseSchema = z.object({
  name: z.string(),
  kind: z.enum(PHASE_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  focus: z.string().nullable(),
  mileageTarget: z.string().nullable(),
});

const programSchema = z.object({
  name: z.string(),
  kind: z.enum(PROGRAM_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  aRace: z.object({ name: z.string(), date: z.string() }).nullable(),
  phases: z.array(phaseSchema).describe("In date order"),
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

function structured<T extends Record<string, unknown>>(output: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

/** The MCP API: the Worker's `/mcp` route, behind OAuth (src/auth). Tests call it directly. */
export const mcpApi = {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
