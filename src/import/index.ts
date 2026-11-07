import { logBodyCompScan } from "../core/body-comp-scans";
import { logCheckIn } from "../core/check-ins";
import { DomainError } from "../core/errors";
import { findPlacement, upsertProgram } from "../core/programs";
import { logRaceResult } from "../core/race-results";
import { logRun } from "../core/runs";
import { addShoe, findShoe, retireShoe } from "../core/shoes";
import { logStrengthSession } from "../core/strength-sessions";
import type { ArchiveSource } from "./archive";
import {
  readBodyCompScans,
  readCheckIns,
  readRaceResults,
  readRuns,
  readShoeLog,
  readStrengthSessions,
  type Sourced,
} from "./legacy";
import { readStructure, type Structure } from "./structure";
import { type Verification, verify } from "./verify";

// The re-runnable import: rebuilds the structured Athlete Record in D1 from a
// checkout of the private archive repo. It wipes D1 and writes every record
// through the domain core, so the import obeys the same rules as the tools.
// It's deterministic: running it twice gives identical results.

export type { ArchiveSource } from "./archive";

/** A record the import couldn't write, and why. */
export type Unresolved = { record: string; source: string; date: string; reason: string };

/** Something the runner should look at, though the import went ahead. */
export type Warning = { source: string; message: string };

/** What the import did. */
export type ImportReport = {
  /** Records that couldn't be written, e.g. dated outside every Phase. They're not in D1. */
  unresolved: Unresolved[];
  warnings: Warning[];
  /** Counts and totals in the archive's files against D1's. */
  verification: Verification[];
};

/** Wipes D1 and rebuilds it from the archive. */
export async function rebuildStructuredRecord(db: D1Database, archive: ArchiveSource): Promise<ImportReport> {
  const report: ImportReport = { unresolved: [], warnings: [], verification: [] };
  const warn = (source: string, message: string) => report.warnings.push({ source, message });

  await wipe(db);
  const structure = readStructure(archive);
  for (const program of byDate(structure.programs, (p) => p.startDate)) {
    await upsertProgram(db, program);
  }
  const checkLabels = labelChecker(db, structure, warn);

  /**
   * Writes each record in date order, through the core. A record the core
   * rejects is reported as unresolved; a written one has its labels checked.
   */
  const load = async <T extends { date: string }>(
    record: string,
    records: Sourced<T>[],
    write: (input: T) => Promise<unknown>,
  ) => {
    for (const { source, labels, warning, input } of byDate(records, (r) => r.input.date)) {
      if (warning) warn(source, warning);
      try {
        await write(input);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        report.unresolved.push({ record, source, date: input.date, reason: error.message });
        continue;
      }
      await checkLabels(input.date, labels);
    }
  };

  const shoeLog = readShoeLog(archive);
  for (const shoe of shoeLog) {
    await addShoe(db, { id: shoe.id, model: shoe.model, notes: shoe.notes });
  }
  const runs = readRuns(archive);
  // A pair the Runs were worn in but the shoe log leaves out is no current
  // pair: add it so its Runs keep their Shoe, and retire it after its last Run.
  const unlogged = new Map<string, string>();
  for (const { input, source } of byDate(runs, (r) => r.input.date)) {
    if (input.shoe && !shoeLog.some((s) => s.id === input.shoe) && !unlogged.has(input.shoe)) {
      unlogged.set(input.shoe, source);
      warn(source, `Shoe ${input.shoe} isn't in the shoe log. Added it, retired on its last Run.`);
      await addShoe(db, { id: input.shoe, notes: "Not in the shoe log: added by the import from its Runs." });
    }
  }
  await load("Run", runs, (input) => logRun(db, input));
  // Retire pairs once their Runs are in: a Run after a pair's retirement is rejected.
  const retiring = [
    ...shoeLog.filter((s) => s.retired),
    ...[...unlogged].map(([id, source]) => ({ id, source, lastRun: null })),
  ];
  for (const shoe of retiring) {
    const date = shoe.lastRun ?? (await findShoe(db, shoe.id))?.lastRun ?? null;
    if (date === null) {
      warn(shoe.source, `Shoe ${shoe.id} is retired but has no Runs, so it's left active.`);
      continue;
    }
    await retireShoe(db, shoe.id, date);
  }

  const strengthSessions = readStrengthSessions(archive);
  const bodyCompScans = readBodyCompScans(archive);
  const checkIns = readCheckIns(archive, structure.checkIns.sleepQuality);
  const raceResults = readRaceResults(archive);
  await load("Strength Session", strengthSessions, (input) => logStrengthSession(db, input));
  await load("Body-comp Scan", bodyCompScans, (input) => logBodyCompScan(db, input));
  await load("Daily Check-in", checkIns, (input) => logCheckIn(db, input));
  await load("Race Result", raceResults, (input) => logRaceResult(db, input));

  report.verification = await verify(db, {
    runs: runs.map((r) => r.input),
    strengthSessions: strengthSessions.length,
    strengthSessionEntries: sum(strengthSessions.map((s) => s.input.entries.length)),
    bodyCompScans: bodyCompScans.length,
    checkIns: checkIns.length,
    raceResults: raceResults.length,
  });
  return report;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Checks a written record's legacy labels against the Phase its date falls
 * in, warning where a label disagrees, and once for each label the structure
 * file doesn't map.
 */
function labelChecker(db: D1Database, structure: Structure, warn: (source: string, message: string) => void) {
  const unmapped = new Set<string>();
  return async (date: string, labels: Sourced<unknown>["labels"]) => {
    for (const { source, label } of labels) {
      const mapped = structure.legacyLabels[label];
      if (!mapped) {
        if (!unmapped.has(label)) warn(source, `training_goal "${label}" isn't in the structure file's legacyLabels.`);
        unmapped.add(label);
        continue;
      }
      const placement = (await findPlacement(db, date))!;
      if (placement.program.name !== mapped.program || (mapped.phase && placement.phase.name !== mapped.phase)) {
        const expected = mapped.phase ? `${mapped.program} / ${mapped.phase}` : mapped.program;
        warn(
          source,
          `training_goal "${label}" maps to ${expected}, but ${date} falls in ${placement.program.name} / ${placement.phase.name}.`,
        );
      }
    }
  };
}

/** `items` sorted by date, keeping their order within a date. */
function byDate<T>(items: T[], date: (item: T) => string): T[] {
  return [...items].sort((a, b) => (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : 0));
}

/** Empties every table, keeping the schema. */
async function wipe(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' " +
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    )
    .all<{ name: string }>();
  if (results.length === 0) return;
  await db.batch([
    db.prepare("PRAGMA defer_foreign_keys = on"),
    ...results.map(({ name }) => db.prepare(`DELETE FROM "${name}"`)),
  ]);
}
