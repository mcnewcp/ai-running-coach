import { parseDate } from "./calendar";
import { DomainError } from "./errors";
import { placeDate } from "./programs";
import { type Attributed, checkNumber, HEART_RATE, merge, optionalText, RATING } from "./records";

// Daily Check-ins: the runner's morning wellness report for one day. There's
// at most one per date: a later report for the same date updates it.
// Belongs to a Phase by its date (ADR 0003).

/**
 * The measures a Check-in can hold, as [field, column, rule]. All optional.
 * Pain ratings are left and right knee in v0.1.
 */
const MEASURES = [
  ["sleepHours", "sleep_hours", { min: 0, max: 24 }],
  ["sleepQuality", "sleep_quality", RATING],
  ["restingHr", "resting_hr", HEART_RATE],
  ["leftKneePain", "left_knee_pain", RATING],
  ["rightKneePain", "right_knee_pain", RATING],
  ["energy", "energy", RATING],
  ["motivation", "motivation", RATING],
  ["lifeStress", "life_stress", RATING],
  ["bodyWeight", "body_weight", {}],
] as const;

type Measure = (typeof MEASURES)[number][0];

export type CheckIn = { date: string; notes: string | null } & Record<Measure, number | null>;

/** A report for one date. Fields left out keep their current value; null clears one. */
export type CheckInInput = { date: string } & Partial<{ [K in Exclude<keyof CheckIn, "date">]: CheckIn[K] | null }>;

export type CheckInWrite = Attributed & {
  /** created: the first report for the date. updated: merged into the date's existing Check-in. */
  status: "created" | "updated";
  checkIn: CheckIn;
};

const COLUMNS = ["date", ...MEASURES.map(([, column]) => column), "notes"];

/**
 * Records the Daily Check-in for a date, or merges the report into the
 * date's existing one. Fails if no Phase covers the date.
 */
export async function logCheckIn(db: D1Database, input: CheckInInput): Promise<CheckInWrite> {
  const date = parseDate(input.date);
  const { program, phase } = await placeDate(db, date);
  const current = await findCheckIn(db, date);
  const empty = Object.fromEntries(MEASURES.map(([field]) => [field, null])) as Record<Measure, number | null>;
  const checkIn = check(merge<CheckIn>(current ?? { date, notes: null, ...empty }, input));
  const updates = COLUMNS.slice(1).map((column) => `${column} = excluded.${column}`);
  await db
    .prepare(
      `INSERT INTO check_ins (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})
       ON CONFLICT (date) DO UPDATE SET ${updates.join(", ")}`,
    )
    .bind(checkIn.date, ...MEASURES.map(([field]) => checkIn[field]), checkIn.notes)
    .run();
  return { status: current ? "updated" : "created", checkIn, program, phase };
}

/** Deletes the Daily Check-in for a date. Returns what was deleted. */
export async function deleteCheckIn(db: D1Database, date: string): Promise<{ deleted: CheckIn }> {
  parseDate(date);
  const checkIn = await findCheckIn(db, date);
  if (!checkIn) throw new DomainError(`There's no Daily Check-in for ${date}.`);
  await db.prepare("DELETE FROM check_ins WHERE date = ?").bind(date).run();
  return { deleted: checkIn };
}

function check(checkIn: CheckIn): CheckIn {
  const checked = { ...checkIn, notes: optionalText(checkIn.notes) };
  for (const [field, , rule] of MEASURES) checked[field] = checkNumber(checkIn[field], field, rule);
  return checked;
}

// --- Storage -----------------------------------------------------------------

async function findCheckIn(db: D1Database, date: string): Promise<CheckIn | null> {
  const row = await db.prepare("SELECT * FROM check_ins WHERE date = ?").bind(date).first<Record<string, unknown>>();
  if (!row) return null;
  const checkIn = { date: row.date, notes: row.notes } as CheckIn;
  for (const [field, column] of MEASURES) checkIn[field] = row[column] as number | null;
  return checkIn;
}
