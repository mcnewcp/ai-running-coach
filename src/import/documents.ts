import { listDocuments, writeDocument } from "../core/documents";
import { listPrograms } from "../core/programs";
import { listRaceResults } from "../core/race-results";
import { RUNNER_PROFILE_PATH } from "../core/runner-profile";
import { type ArchiveSource, readRequired } from "./archive";
import {
  CHECK_INS_PATH,
  INBODY_PATH,
  LIFTS_PATH,
  PREBUILD_RUNS_PATH,
  RACE_HISTORY_PATH,
  readRaceNarratives,
  RUNS_PATH,
  SHOE_LOG_PATH,
} from "./legacy";
import { STRUCTURE_PATH } from "./structure";
import { type Excerpt, findSection, type Link, relevel, replaceLinks, wholeFile } from "./markdown";
import { type LinkTarget, type Part, readVaultConfig, VAULT_CONFIG_PATH } from "./vault-config";

// The document half of the re-runnable import: rebuilds the runner's vault in
// R2 (README, "Documents") from the same archive checkout as D1. It wipes the
// vault's documents and writes each one through the domain core, rewriting
// links that pointed into the archive's layout. It's deterministic: running
// it twice gives identical documents.

/** What the document import did. */
export type DocumentsReport = {
  /** The vault paths written, sorted. */
  written: string[];
  /** Links left as they were, because the import couldn't tell where they go now. */
  unrewrittenLinks: { source: string; link: string; reason: string }[];
  /** Documents the vault should have but doesn't, e.g. a Phase's Plan or a section the vault config names. */
  missing: { source: string; message: string }[];
  /** Things the runner should look at, though the import went ahead. */
  warnings: { source: string; message: string }[];
};

/** The archive's Program folders, each with plans/ and logs/ inside. */
const PROGRAMS = "programs/";

/** The records a legacy data file held, now in the structured record (D1). */
const STRUCTURED: Record<string, string> = {
  [RUNS_PATH]: "Runs",
  [PREBUILD_RUNS_PATH]: "Runs",
  [SHOE_LOG_PATH]: "Shoes",
  [LIFTS_PATH]: "Strength Sessions",
  [INBODY_PATH]: "Body-comp Scans",
  [CHECK_INS_PATH]: "Daily Check-ins",
  [RACE_HISTORY_PATH]: "Race Results",
};

/** Archive text going into a document; its links are relative to `from`. */
type Piece = { from: string; excerpt: Excerpt };

/** A document to write: archive pieces, composed into its content once their links are rewritten. */
type Draft = { path: string; pieces: Piece[]; compose: (bodies: string[]) => string };

/** Wipes the vault's documents and rebuilds them from the archive. */
export async function rebuildDocuments(
  store: { db: D1Database; bucket: R2Bucket },
  archive: ArchiveSource,
): Promise<DocumentsReport> {
  const report: DocumentsReport = { written: [], unrewrittenLinks: [], missing: [], warnings: [] };
  const config = readVaultConfig(archive);
  const drafts: Draft[] = [];
  /** Where each archive file copied whole now lives in the vault. */
  const moved = new Map<string, string>();
  const copy = (from: string, to: string) => {
    moved.set(from, to);
    const lines = readRequired(archive, from).split(/\r?\n/);
    drafts.push({ path: to, pieces: [{ from, excerpt: { firstLine: 1, lines } }], compose: ([body]) => body! });
  };

  // The Runner Profile: the athlete-specific parts, with the Home Timezone as a property.
  const profile: Piece[] = [];
  for (const [index, part] of config.runnerProfile.parts.entries()) {
    const excerpt = readPart(archive, part);
    if (excerpt === null) {
      report.missing.push({
        source: `${VAULT_CONFIG_PATH} runnerProfile.parts[${index}]`,
        message: `${part.from} has no section ${part.section!.join(" > ")}.`,
      });
      continue;
    }
    profile.push({ from: part.from, excerpt: { ...excerpt, lines: relevel(excerpt.lines, 2) } });
  }
  drafts.push({
    path: RUNNER_PROFILE_PATH,
    pieces: profile,
    compose: (bodies) =>
      `---\ntimezone: ${config.runnerProfile.timezone}\n---\n# Runner Profile\n\n${bodies.join("\n\n")}\n`,
  });

  // Plans and Logs, keeping each Program's folder and file names.
  for (const from of archive.list(PROGRAMS)) {
    const to = programPath(from);
    if (to === null) report.warnings.push({ source: from, message: "Not a markdown document, so it's not in the vault." });
    else copy(from, to);
  }

  for (const resource of config.resources) {
    copy(resource.from, resource.to ?? `Resources/${resource.from.split("/").at(-1)}`);
  }

  // Race narratives, one document per race in the race history.
  const narratives = readRaceNarratives(archive);
  for (const narrative of narratives) {
    drafts.push({
      path: narrative.path,
      pieces: [{ from: RACE_HISTORY_PATH, excerpt: narrative.excerpt }],
      compose: ([body]) => `${body!}\n`,
    });
  }

  const rewrite = (piece: Piece, documentPath: string): string[] =>
    replaceLinks(piece.excerpt.lines, (link) => {
      const target = rewriteLink(link, piece.from, documentPath, { config, moved, narratives });
      if (typeof target === "object") {
        report.unrewrittenLinks.push({
          source: `${piece.from}:${piece.excerpt.firstLine + link.line}`,
          link: link.raw,
          reason: target.unrewritten,
        });
        return undefined;
      }
      return target;
    });

  await wipe(store.bucket);
  const seen = new Set<string>();
  for (const draft of drafts.sort((a, b) => compare(a.path, b.path))) {
    if (seen.has(draft.path)) {
      report.warnings.push({
        source: draft.pieces[0]?.from ?? draft.path,
        message: `Another document is already at ${draft.path}, so this one isn't in the vault.`,
      });
      continue;
    }
    seen.add(draft.path);
    const content = draft.compose(draft.pieces.map((piece) => rewrite(piece, draft.path).join("\n")));
    const result = await writeDocument(store.bucket, { path: draft.path, content, condition: { createOnly: true } });
    if (result.status !== "written") throw new Error(`Couldn't write ${draft.path}: ${result.message}`);
    report.written.push(draft.path);
  }
  report.missing.push(...(await unresolvedLinks(store.db, new Set(report.written))));
  return report;
}

/**
 * The structured record's links into the vault that don't resolve: a Phase's
 * Plan or a Race Result's narrative that isn't among the `written` paths.
 */
async function unresolvedLinks(db: D1Database, written: Set<string>): Promise<DocumentsReport["missing"]> {
  const missing = (path: string | null): path is string => path !== null && !written.has(path);
  const plans = (await listPrograms(db)).flatMap((program) =>
    program.phases
      .filter((phase) => missing(phase.planPath))
      .map((phase) => ({
        source: STRUCTURE_PATH,
        message: `${program.name} / ${phase.name} links the Plan ${phase.planPath}, which isn't in the vault.`,
      })),
  );
  const narratives = (await listRaceResults(db))
    .filter((result) => missing(result.narrativePath))
    .map(({ date, name, narrativePath }) => ({
      source: RACE_HISTORY_PATH,
      message: `The Race Result ${name} on ${date} links the narrative ${narrativePath}, which isn't in the vault.`,
    }));
  return [...plans, ...narratives];
}

/** programs/<name>/plans/<file> → Programs/<name>/Plans/<file>, and the same for logs/. Null if it isn't markdown. */
function programPath(from: string): string | null {
  if (!from.endsWith(".md")) return null;
  const [, ...segments] = from.split("/");
  if (segments.length >= 3) segments[1] = { plans: "Plans", logs: "Logs" }[segments[1]!] ?? segments[1]!;
  return ["Programs", ...segments].join("/");
}

/**
 * Where a link written in the archive file `from` should point from the vault
 * document at `documentPath`: the rewritten link, undefined to keep it as it
 * is (a web link or an anchor), or why it can't be rewritten.
 */
function rewriteLink(
  link: Link,
  from: string,
  documentPath: string,
  known: { config: { links: Record<string, LinkTarget> }; moved: Map<string, string>; narratives: { path: string; anchors: string[] }[] },
): string | undefined | { unrewritten: string } {
  const { target } = link;
  if (target === "" || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
  const hash = target.indexOf("#");
  const anchor = hash < 0 ? "" : target.slice(hash);
  const path = resolve(from, safeDecode(hash < 0 ? target : target.slice(0, hash)));
  if (path === null) return { unrewritten: "It points outside the archive." };

  const configured = known.config.links[path];
  if (typeof configured === "object") return `${link.text} (${configured.note})`;
  if (typeof configured === "string") {
    return /^[a-z][a-z0-9+.-]*:/i.test(configured)
      ? linkTo(link, configured)
      : linkTo(link, relative(documentPath, configured) + anchor);
  }
  const moved = known.moved.get(path);
  if (moved !== undefined) return linkTo(link, relative(documentPath, moved) + anchor);
  if (path === RACE_HISTORY_PATH && anchor !== "") {
    const narrative = known.narratives.find((n) => n.anchors.includes(anchor.slice(1).toLowerCase()));
    if (narrative) return linkTo(link, relative(documentPath, narrative.path));
  }
  const records = STRUCTURED[path];
  if (records !== undefined) return `${link.text} (structured record: ${records})`;
  return { unrewritten: `${path} isn't in the vault, and ${VAULT_CONFIG_PATH} doesn't say where links to it go.` };
}

/** The link with its destination replaced. */
function linkTo(link: Link, destination: string): string {
  return `${link.raw.startsWith("!") ? "!" : ""}[${link.text}](${destination}${link.title})`;
}

/** The archive path a relative link in `from` points at, or null if it leaves the archive. */
function resolve(from: string, target: string): string | null {
  const segments = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

/** The relative link from the document at `from` to the vault path `to`, with spaces encoded. */
function relative(from: string, to: string): string {
  const base = from.split("/").slice(0, -1);
  const target = to.split("/");
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common]) common++;
  const up = base.length - common;
  return [...Array<string>(up).fill(".."), ...target.slice(common)].map((s) => s.replaceAll(" ", "%20")).join("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The archive text a part names, or null if its file lacks the section. */
function readPart(archive: ArchiveSource, part: Part): Excerpt | null {
  const text = readRequired(archive, part.from);
  if (!part.section) return wholeFile(text);
  return findSection(text, part.section, part.heading ?? true);
}

/**
 * Makes `to`'s documents an exact copy of `from`'s: wipes them, copies every
 * document across, then checks both list the same paths and versions (R2's
 * version is the content's MD5, so equal versions mean equal content).
 * Anything in `to` that isn't a document is left alone.
 */
export async function mirrorDocuments(from: R2Bucket, to: R2Bucket): Promise<void> {
  await wipe(to);
  const documents = await listDocuments(from, "");
  for (const { path } of documents) {
    const object = (await from.get(path))!;
    await to.put(path, await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
  }
  const copied = await listDocuments(to, "");
  if (JSON.stringify(copied) !== JSON.stringify(documents)) {
    throw new Error(`The copied documents don't match: ${documents.length} documents, ${copied.length} copied.`);
  }
}

/**
 * Deletes every document in the vault. Anything else in the bucket, like the
 * Obsidian settings Remotely Save syncs, is left alone.
 */
async function wipe(bucket: R2Bucket): Promise<void> {
  const documents = await listDocuments(bucket, "");
  for (let i = 0; i < documents.length; i += 1000) {
    await bucket.delete(documents.slice(i, i + 1000).map((d) => d.path));
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
