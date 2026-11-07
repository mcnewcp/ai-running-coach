// The re-runnable import command: wipes and rebuilds D1 from a checkout of
// the private archive repo.
//
//   npm run import -- <archive> [--extraction <dir>] [--remote] [--yes]
//
// It always rebuilds the local D1 (the one `wrangler dev` uses) through the
// domain core, and prints the verification report. With --remote it then
// copies that local D1 to the remote one, after asking for confirmation if
// anything didn't match. It exits non-zero unless every record was imported
// and every count matched. The report holds Athlete Record data: keep it out
// of anything public.
//
// Each store is rebuilt by its own step below; the documents (R2) get a
// matching step that reads the same archive.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { type ArchiveSource, dumpStatements, type ImportReport, rebuildStructuredRecord } from "../src/import";
import { formatReport, isClean } from "../src/import/report";
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
      "  --remote            also copy the rebuilt record to the remote D1\n" +
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
  clean = isClean(report);
  if (options.remote) {
    if (clean || options.yes || (await confirm("Not everything matched. Copy to the remote D1 anyway?"))) {
      await copyD1ToRemote(proxy.env.DB);
    } else {
      console.log("Left the remote D1 alone.");
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
