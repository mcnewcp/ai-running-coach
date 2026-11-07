import { roundMiles } from "../core/mileage-cap";
import type { RunInput } from "../core/runs";

// The verification report: counts and totals in the archive's files against
// what ended up in D1. At cutover every row must match.

export type Verification = { measure: string; archive: number; imported: number; matches: boolean };

/** What the archive's files hold, counted from the records read from them. */
export type ArchiveTotals = {
  runs: RunInput[];
  strengthSessions: number;
  strengthSessionEntries: number;
  bodyCompScans: number;
  checkIns: number;
  raceResults: number;
};

const NO_SHOE = "no Shoe";

/** Compares the archive's totals with D1's, one row per measure. */
export async function verify(db: D1Database, archive: ArchiveTotals): Promise<Verification[]> {
  const count = async (table: string) =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  const { results: shoeMiles } = await db
    .prepare("SELECT shoe_id AS shoe, SUM(distance_miles) AS miles FROM runs GROUP BY shoe_id")
    .all<{ shoe: string | null; miles: number }>();
  const importedMiles = new Map(shoeMiles.map(({ shoe, miles }) => [shoe ?? NO_SHOE, miles]));
  const archiveMiles = new Map<string, number>();
  for (const run of archive.runs) {
    const shoe = run.shoe ?? NO_SHOE;
    archiveMiles.set(shoe, (archiveMiles.get(shoe) ?? 0) + run.distance);
  }
  const shoes = [...new Set([...archiveMiles.keys(), ...importedMiles.keys()])].sort((a, b) =>
    a === NO_SHOE ? 1 : b === NO_SHOE ? -1 : a < b ? -1 : 1,
  );
  const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

  const row = (measure: string, archived: number, imported: number): Verification => ({
    measure,
    archive: archived,
    imported,
    matches: archived === imported,
  });
  return [
    row("Runs", archive.runs.length, await count("runs")),
    row("Total miles", roundMiles(sum(archiveMiles.values())), roundMiles(sum(importedMiles.values()))),
    ...shoes.map((shoe) =>
      row(`Miles in ${shoe}`, roundMiles(archiveMiles.get(shoe) ?? 0), roundMiles(importedMiles.get(shoe) ?? 0)),
    ),
    row("Strength Sessions", archive.strengthSessions, await count("strength_sessions")),
    row("Strength Session entries", archive.strengthSessionEntries, await count("exercise_entries")),
    row("Body-comp Scans", archive.bodyCompScans, await count("body_comp_scans")),
    row("Daily Check-ins", archive.checkIns, await count("check_ins")),
    row("Race Results", archive.raceResults, await count("race_results")),
  ];
}
