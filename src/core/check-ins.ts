import { parseDate } from "./calendar";
import { DomainError } from "./errors";
import { attribute, type Attributed, checkNumber, HEART_RATE, merge, optionalText, RATING } from "./records";

// Daily Check-ins: the runner's morning wellness report for one day. There's
// at most one per date: a later report for the same date updates it.
// Belongs to a Phase by its date (ADR 0003).

export type CheckIn = {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  restingHr: number | null;
  /** Pain ratings, 0-10: left and right knee in v0.1. */
  leftKneePain: number | null;
  rightKneePain: number | null;
  energy: number | null;
  motivation: number | null;
  lifeStress: number | null;
  bodyWeight: number | null;
  notes: string | null;
};

/** A report for one date. Fields left out keep their current value; null clears one. */
export type CheckInInput = { date: string } & Partial<{ [K in Exclude<keyof CheckIn, "date">]: CheckIn[K] | null }>;

export type CheckInWrite = Attributed & {
  /** created: the first report for the date. updated: merged into the date's existing Check-in. */
  status: "created" | "updated";
  checkIn: CheckIn;
};

const EMPTY: Omit<CheckIn, "date"> = {
  sleepHours: null,
  sleepQuality: null,
  restingHr: null,
  leftKneePain: null,
  rightKneePain: null,
  energy: null,
  motivation: null,
  lifeStress: null,
  bodyWeight: null,
  notes: null,
};

/**
 * Records the Daily Check-in for a date, or merges the report into the
 * date's existing one. Fails if no Phase covers the date.
 */
export async function logCheckIn(db: D1Database, input: CheckInInput): Promise<CheckInWrite> {
  const date = parseDate(input.date);
  const attributed = await attribute(db, date);
  const current = await findCheckIn(db, date);
  const checkIn = check(merge(current ?? { date, ...EMPTY }, input));
  await db
    .prepare(
      `INSERT INTO check_ins (date, sleep_hours, sleep_quality, resting_hr, left_knee_pain, right_knee_pain,
         energy, motivation, life_stress, body_weight, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
         resting_hr = excluded.resting_hr, left_knee_pain = excluded.left_knee_pain,
         right_knee_pain = excluded.right_knee_pain, energy = excluded.energy, motivation = excluded.motivation,
         life_stress = excluded.life_stress, body_weight = excluded.body_weight, notes = excluded.notes`,
    )
    .bind(
      checkIn.date,
      checkIn.sleepHours,
      checkIn.sleepQuality,
      checkIn.restingHr,
      checkIn.leftKneePain,
      checkIn.rightKneePain,
      checkIn.energy,
      checkIn.motivation,
      checkIn.lifeStress,
      checkIn.bodyWeight,
      checkIn.notes,
    )
    .run();
  return { status: current ? "updated" : "created", checkIn, ...attributed };
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
  return {
    date: checkIn.date,
    sleepHours: checkNumber(checkIn.sleepHours, "sleepHours", { min: 0, max: 24 }),
    sleepQuality: checkNumber(checkIn.sleepQuality, "sleepQuality", RATING),
    restingHr: checkNumber(checkIn.restingHr, "restingHr", HEART_RATE),
    leftKneePain: checkNumber(checkIn.leftKneePain, "leftKneePain", RATING),
    rightKneePain: checkNumber(checkIn.rightKneePain, "rightKneePain", RATING),
    energy: checkNumber(checkIn.energy, "energy", RATING),
    motivation: checkNumber(checkIn.motivation, "motivation", RATING),
    lifeStress: checkNumber(checkIn.lifeStress, "lifeStress", RATING),
    bodyWeight: checkNumber(checkIn.bodyWeight, "bodyWeight"),
    notes: optionalText(checkIn.notes),
  };
}

// --- Storage -----------------------------------------------------------------

type CheckInRow = {
  date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  resting_hr: number | null;
  left_knee_pain: number | null;
  right_knee_pain: number | null;
  energy: number | null;
  motivation: number | null;
  life_stress: number | null;
  body_weight: number | null;
  notes: string | null;
};

async function findCheckIn(db: D1Database, date: string): Promise<CheckIn | null> {
  const row = await db.prepare("SELECT * FROM check_ins WHERE date = ?").bind(date).first<CheckInRow>();
  if (!row) return null;
  return {
    date: row.date,
    sleepHours: row.sleep_hours,
    sleepQuality: row.sleep_quality,
    restingHr: row.resting_hr,
    leftKneePain: row.left_knee_pain,
    rightKneePain: row.right_knee_pain,
    energy: row.energy,
    motivation: row.motivation,
    lifeStress: row.life_stress,
    bodyWeight: row.body_weight,
    notes: row.notes,
  };
}
