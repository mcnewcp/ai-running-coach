import { DomainError } from "./errors";

/**
 * The unstructured Athlete Record: markdown documents in R2, laid out as the
 * runner's Obsidian vault (README, "Documents"). A document's path is its R2
 * key and its Obsidian path.
 */

/** A document and the version it was read at. */
export type Document = {
  path: string;
  content: string;
  /** Opaque. Pass it back to `writeDocument` to update the document. */
  version: string;
};

export type WriteResult =
  | { status: "written"; path: string; version: string }
  | {
      /** Nothing was written. Merge with the current content and retry. */
      status: "conflict";
      path: string;
      message: string;
      /** The current content, or null if there's no document at `path`. */
      content: string | null;
      /** The current version, or null if there's no document at `path`. */
      version: string | null;
    };

/**
 * Fails unless `path` is a markdown document's path inside the vault: relative,
 * `/`-separated, with no empty, `.`, `..` or hidden segments (which keeps
 * Obsidian's own `.obsidian/` settings out of reach), and ending in `.md`.
 */
export function checkPath(path: string): void {
  const problem = pathProblem(path);
  if (problem !== undefined) {
    throw new DomainError(
      `"${path}" is not a valid document path: ${problem}. Example: "Programs/2026-01-base/Plans/week-01.md".`,
    );
  }
}

/** Why `path` isn't a document path, or undefined if it is one. */
function pathProblem(path: string): string | undefined {
  if (!path.endsWith(".md")) return "it must be a markdown file ending in .md";
  return folderProblem(path.split("/"));
}

/** Why `segments` aren't a path inside the vault, or undefined if they are. */
function folderProblem(segments: string[]): string | undefined {
  for (const segment of segments) {
    if (segment === "") return "it must be relative, with no empty folder names";
    if (segment.startsWith(".")) return "no folder or file name may start with a dot";
    if (segment.includes("\\")) return "separate folders with /, not \\";
    if (/\p{Cc}/u.test(segment)) return "it has a control character";
  }
  return undefined;
}

/** A document's path and current version, as listed. */
export type DocumentEntry = { path: string; version: string };

/**
 * Lists the documents whose paths start with `prefix` (the whole vault if it's
 * empty), sorted by path. Anything that isn't a document, like Obsidian's
 * `.obsidian/` settings or an image, is left out.
 */
export async function listDocuments(bucket: R2Bucket, prefix: string): Promise<DocumentEntry[]> {
  // A trailing `/` (or nothing at all) is fine: "everything in this folder".
  const segments = prefix === "" ? [] : prefix.split("/");
  if (segments.at(-1) === "" && segments.length > 1) segments.pop();
  const problem = folderProblem(segments);
  if (problem !== undefined) {
    throw new DomainError(`"${prefix}" is not a valid prefix: ${problem}. Example: "Programs/2026-01-base/Plans/".`);
  }

  const documents: DocumentEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) {
      if (pathProblem(object.key) === undefined) documents.push({ path: object.key, version: object.etag });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return documents;
}

/** Reads the document at `path`, or fails if there isn't one. */
export async function readDocument(bucket: R2Bucket, path: string): Promise<Document> {
  const document = await findDocument(bucket, path);
  if (document === null) throw new DomainError(`There's no document at "${path}".`);
  return document;
}

/** Reads the document at `path`, or returns null if there isn't one. */
export async function findDocument(bucket: R2Bucket, path: string): Promise<Document | null> {
  checkPath(path);
  const object = await bucket.get(path);
  if (object === null) return null;
  return { path, content: await object.text(), version: object.etag };
}

/**
 * When a write may go ahead: only if no document exists yet, or only if the
 * document is still at the version the caller read.
 */
export type WriteCondition = { createOnly: true } | { expectedVersion: string };

/**
 * The condition a write asks for: `createOnly: true` to create a document, or
 * the `expectedVersion` it read to update one. Fails unless exactly one is
 * given, so a write can never skip the check by giving neither.
 */
export function writeCondition(request: { createOnly?: boolean; expectedVersion?: string }): WriteCondition {
  const creating = request.createOnly === true;
  if (creating === (request.expectedVersion !== undefined)) {
    throw new DomainError(
      "Pass exactly one of create_only: true (to create a new document) or " +
        "expected_version (to update one, with the version you read).",
    );
  }
  return creating ? { createOnly: true } : { expectedVersion: request.expectedVersion! };
}

/**
 * Writes the document at `path` if `condition` holds, else writes nothing and
 * returns a conflict with the current document, so the caller can merge and
 * retry. This is what keeps the runner's Obsidian edits from being silently
 * overwritten (ADR 0002).
 */
export async function writeDocument(
  bucket: R2Bucket,
  request: { path: string; content: string; condition: WriteCondition },
): Promise<WriteResult> {
  const { path, condition } = request;
  checkPath(path);
  const createOnly = "createOnly" in condition;
  if (!createOnly && !/^[0-9A-Za-z-]+$/.test(condition.expectedVersion)) {
    throw new DomainError(
      `"${condition.expectedVersion}" is not a document version. Use the version returned when you read the document.`,
    );
  }
  const object = await bucket.put(path, request.content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    // R2 checks the condition and writes atomically, so an edit synced from
    // Obsidian between the check and the write can't be lost.
    onlyIf: createOnly ? { etagDoesNotMatch: "*" } : { etagMatches: condition.expectedVersion },
  });
  if (object !== null) return { status: "written", path, version: object.etag };

  const current = await bucket.get(path);
  const why = createOnly
    ? "already exists"
    : current === null
      ? "no longer exists"
      : "changed since you read it";
  return {
    status: "conflict",
    path,
    message: `"${path}" ${why}. Nothing was written.`,
    content: current === null ? null : await current.text(),
    version: current?.etag ?? null,
  };
}
