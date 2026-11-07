import { parseDate } from "./calendar";
import { DomainError } from "./errors";
import { attribute, type Attributed, checkNumber, merge, notFound, optionalText } from "./records";

// Body-comp Scans: one body-composition measurement. Only the metrics the
// printout shows are recorded; the rest stay empty. Belongs to a Phase by its
// date (ADR 0003).

/** The metrics a scan can hold, as [field, column, rule]. All optional. */
const METRICS = [
  ["weight", "weight", {}],
  ["skeletalMuscleMass", "skeletal_muscle_mass", {}],
  ["bodyFatMass", "body_fat_mass", {}],
  ["bodyFatPercent", "body_fat_percent", { max: 100 }],
  ["bmi", "bmi", {}],
  ["totalBodyWater", "total_body_water", {}],
  ["leanBodyMass", "lean_body_mass", {}],
  ["visceralFatLevel", "visceral_fat_level", {}],
  ["basalMetabolicRate", "basal_metabolic_rate", {}],
  ["score", "score", {}],
] as const;

type Metric = (typeof METRICS)[number][0];

export type BodyCompScan = { id: number; date: string; notes: string | null } & Record<Metric, number | null>;

export type BodyCompScanInput = { date: string; notes?: string | null } & Partial<Record<Metric, number | null>>;

/** Fields left out keep their value; null clears one. */
export type BodyCompScanCorrection = { id: number; date?: string; notes?: string | null } & Partial<
  Record<Metric, number | null>
>;

export type BodyCompScanWrite = Attributed & { bodyCompScan: BodyCompScan };

const COLUMNS = METRICS.map(([, column]) => column);

/** Records a Body-comp Scan. Fails if no Phase covers its date or it has no metrics. */
export async function logBodyCompScan(db: D1Database, input: BodyCompScanInput): Promise<BodyCompScanWrite> {
  const empty = Object.fromEntries(METRICS.map(([field]) => [field, null])) as Record<Metric, number | null>;
  const scan = check(merge<BodyCompScan>({ id: 0, date: input.date, notes: null, ...empty }, input));
  const attributed = await attribute(db, scan.date);
  const row = await db
    .prepare(
      `INSERT INTO body_comp_scans (date, notes, ${COLUMNS.join(", ")})
       VALUES (?, ?, ${COLUMNS.map(() => "?").join(", ")}) RETURNING id`,
    )
    .bind(scan.date, scan.notes, ...METRICS.map(([field]) => scan[field]))
    .first<{ id: number }>();
  return { bodyCompScan: { ...scan, id: row!.id }, ...attributed };
}

/** Corrects a Body-comp Scan. Fails if no Phase covers the new date. */
export async function updateBodyCompScan(
  db: D1Database,
  correction: BodyCompScanCorrection,
): Promise<BodyCompScanWrite> {
  const scan = check(merge(await loadScan(db, correction.id), correction));
  const attributed = await attribute(db, scan.date);
  await db
    .prepare(
      `UPDATE body_comp_scans SET date = ?, notes = ?, ${COLUMNS.map((column) => `${column} = ?`).join(", ")}
       WHERE id = ?`,
    )
    .bind(scan.date, scan.notes, ...METRICS.map(([field]) => scan[field]), scan.id)
    .run();
  return { bodyCompScan: scan, ...attributed };
}

/** Deletes a Body-comp Scan. Returns what was deleted. */
export async function deleteBodyCompScan(db: D1Database, id: number): Promise<{ deleted: BodyCompScan }> {
  const scan = await loadScan(db, id);
  await db.prepare("DELETE FROM body_comp_scans WHERE id = ?").bind(id).run();
  return { deleted: scan };
}

function check(scan: BodyCompScan): BodyCompScan {
  const checked = { ...scan, date: parseDate(scan.date), notes: optionalText(scan.notes) };
  for (const [field, , rule] of METRICS) checked[field] = checkNumber(scan[field], field, rule);
  if (METRICS.every(([field]) => checked[field] === null)) {
    throw new DomainError("A Body-comp Scan needs at least one metric from the printout.");
  }
  return checked;
}

async function loadScan(db: D1Database, id: number): Promise<BodyCompScan> {
  const row = await db.prepare("SELECT * FROM body_comp_scans WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) notFound("Body-comp Scan", id);
  const scan = { id: row.id, date: row.date, notes: row.notes } as BodyCompScan;
  for (const [field, column] of METRICS) scan[field] = row[column] as number | null;
  return scan;
}
