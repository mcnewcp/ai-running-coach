import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listDocuments, readDocument, writeCondition, writeDocument } from "../core/documents";
import { structured } from "./shared";

/**
 * The documents tools: the Athlete Record's markdown documents in R2 (Runner
 * Profile, Plans, Logs, race narratives), laid out as the runner's Obsidian
 * vault.
 */
export function registerDocumentTools(server: McpServer, env: Env) {
  const bucket = env.DOCUMENTS;
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
    async ({ path, content, create_only, expected_version }) =>
      structured(
        await writeDocument(bucket, {
          path,
          content,
          condition: writeCondition({ createOnly: create_only, expectedVersion: expected_version }),
        }),
      ),
  );
}
