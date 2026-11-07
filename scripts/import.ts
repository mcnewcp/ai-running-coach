// The re-runnable import command: wipes and rebuilds D1 and R2 from a
// checkout of the private archive repo.
//
//   npm run import -- <archive> [--extraction <dir>] [--remote] [--yes]
//
// It always rebuilds the local D1 and R2 (the ones `wrangler dev` uses)
// through the domain core, and prints the reports. With --remote it then
// copies both to the remote D1 and R2, after asking for confirmation if
// anything didn't match. It exits non-zero unless every record was imported,
// every count matched, every document the record links is in the vault and
// every link was rewritten. The reports hold Athlete Record data: keep them
// out of anything public.
//
// Each store is rebuilt by its own step below, from the same archive.
import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import {
  type ArchiveSource,
  type DocumentsReport,
  dumpStatements,
  type ImportReport,
  mirrorDocuments,
  rebuildDocuments,
  rebuildStructuredRecord,
} from "../src/import";
import { documentsClean, formatDocumentsReport, formatReport, isClean } from "../src/import/report";
import { rowCountsQuery } from "../src/import/tables";

const USAGE = "Usage: npm run import -- <archive> [--extraction <dir>] [--remote] [--yes]";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    extraction: { type: "string" },
    remote: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (options.help || positionals.length !== 1) {
  console.log(
    `${USAGE}\n\n` +
      "  <archive>           a checkout of the private archive repo\n" +
      "  --extraction <dir>  the reviewed extraction folder, if it isn't <archive>/extraction\n" +
      "  --remote            also copy the rebuilt record to the remote D1 and R2\n" +
      "  --yes               copy to remote without asking, even if something didn't match",
  );
  process.exit(options.help ? 0 : 2);
}

const archiveDir = resolve(positionals[0]!);
const extractionDir = resolve(options.extraction ?? join(archiveDir, "extraction"));
const archive = folderSource(archiveDir, extractionDir);

wrangler("d1", "migrations", "apply", "DB", "--local");
const proxy = await getPlatformProxy<Env>({ remoteBindings: false });
let clean: boolean;
try {
  const report = await rebuildD1(proxy.env.DB);
  const documents = await rebuildR2(proxy.env.DB, proxy.env.DOCUMENTS);
  clean = isClean(report) && documentsClean(documents);
  if (options.remote) {
    if (clean || options.yes || (await confirm("Not everything matched. Copy to the remote D1 and R2 anyway?"))) {
      await copyD1ToRemote(proxy.env.DB);
      await copyR2ToRemote(proxy.env.DOCUMENTS);
    } else {
      console.log("Left the remote D1 and R2 alone.");
    }
  }
} finally {
  await proxy.dispose();
}
process.exit(clean ? 0 : 1);

/** Step: wipe and rebuild the local D1, and print the report. */
async function rebuildD1(db: D1Database): Promise<ImportReport> {
  console.log(`Rebuilding the local D1 from ${archiveDir} (extraction: ${extractionDir})…`);
  const report = await rebuildStructuredRecord(db, archive);
  console.log(`\n${formatReport(report)}\n`);
  return report;
}

/** Step: wipe and rebuild the local R2 (the vault), and print its report. Needs D1 rebuilt first. */
async function rebuildR2(db: D1Database, bucket: R2Bucket): Promise<DocumentsReport> {
  console.log("Rebuilding the local R2 (the vault)…");
  const report = await rebuildDocuments({ db, bucket }, archive);
  console.log(`\n${formatDocumentsReport(report)}\n`);
  return report;
}

/**
 * Step: make the remote R2's documents an exact copy of the local one's.
 * Anything else in the bucket, like Obsidian settings Remotely Save synced,
 * is left alone. It reaches the remote bucket through a remote binding.
 */
async function copyR2ToRemote(bucket: R2Bucket): Promise<void> {
  const { r2_buckets } = unstable_readConfig({ config: resolve("wrangler.jsonc") });
  const binding = r2_buckets.find((b: { binding: string }) => b.binding === "DOCUMENTS");
  if (!binding?.bucket_name) throw new Error("wrangler.jsonc has no DOCUMENTS bucket.");
  const config = resolve(".wrangler/import/remote-r2.json");
  mkdirSync(resolve(".wrangler/import"), { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      name: "ai-running-coach-import",
      compatibility_date: "2026-08-01",
      r2_buckets: [{ binding: "DOCUMENTS", bucket_name: binding.bucket_name, remote: true }],
    }),
  );
  const remote = await getPlatformProxy<{ DOCUMENTS: R2Bucket }>({ configPath: config, persist: false });
  try {
    await mirrorDocuments(bucket, remote.env.DOCUMENTS);
  } finally {
    await remote.dispose();
  }
  console.log("Copied the vault to the remote R2; its documents match.");
}

/** Step: make the remote D1 an exact copy of the local one, then check its row counts. */
async function copyD1ToRemote(db: D1Database): Promise<void> {
  const file = resolve(".wrangler/import/remote-d1.sql");
  mkdirSync(resolve(".wrangler/import"), { recursive: true });
  writeFileSync(file, (await dumpStatements(db)).map((statement) => `${statement};\n`).join(""));
  wrangler("d1", "migrations", "apply", "DB", "--remote");
  wrangler("d1", "execute", "DB", "--remote", "--yes", "--file", file);

  const counts = await rowCountsQuery(db);
  const local = await db.prepare(counts).first<Record<string, number>>();
  const output = wrangler("d1", "execute", "DB", "--remote", "--json", "--command", counts);
  const remote = (JSON.parse(output) as { results: Record<string, number>[] }[])[0]!.results[0];
  if (JSON.stringify(remote) !== JSON.stringify(local)) {
    throw new Error(`The remote D1's row counts don't match the local one's: ${JSON.stringify({ local, remote })}`);
  }
  console.log("Copied to the remote D1; its row counts match.");
}

/** The archive checkout on disk, with its extraction/ files read from `extractionDir`. */
function folderSource(root: string, extraction: string): ArchiveSource {
  return {
    read(path) {
      const file = path.startsWith("extraction/") ? join(extraction, path.slice("extraction/".length)) : join(root, path);
      try {
        return readFileSync(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    list(prefix) {
      const folder = prefix.startsWith("extraction/") ? extraction : root;
      const inside = prefix.startsWith("extraction/") ? prefix.slice("extraction/".length) : prefix;
      const base = prefix.startsWith("extraction/") ? "extraction/" : "";
      const dir = join(folder, inside);
      if (!existsSync(dir)) return [];
      return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
        .filter((entry) => entry.isFile())
        .map((entry) => base + relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .filter((path) => !path.split("/").some((segment) => segment.startsWith(".")))
        .sort();
    },
  };
}

/** Runs a wrangler command, showing its progress; returns its output if it's JSON. */
function wrangler(...args: string[]): string {
  const json = args.includes("--json");
  const output = execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", json ? "pipe" : "inherit", "inherit"],
    env: { ...process.env, CI: "true" },
  });
  return output ?? "";
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`${question} [y/N] `);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}
