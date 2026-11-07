import { parseDate, weekOf } from "./calendar";
import { DomainError } from "./errors";
import { type WeekStanding, weekStanding } from "./mileage-cap";
import { attribute, type Attributed, checkNumber, notFound, optionalText } from "./records";
import { checkShoeForRun, getShoe, type Shoe } from "./shoes";

// Runs: one completed run each. A Run's Phase and Program are derived from
// its date (ADR 0003), never stored.

/** A recorded Run. Fields the runner didn't report are null, never invented. */
export type Run = {
  id: number;
  date: string;
  type: string | null;
  /** Miles. */
  distance: number;
  /** h:mm:ss, or m:ss under an hour. */
  duration: string | null;
  /** Derived from distance and duration: m:ss per mile. */
  pace: string | null;
  avgHr: number | null;
  vo2Max: number | null;
  /** The Shoe's identifier. */
  shoe: string | null;
  /** 0-10. */
  leftKneePain: number | null;
  /** 0-10. */
  rightKneePain: number | null;
  notes: string | null;
};

/** The Run's fields as reported. Omitted optional fields are left empty. */
export type RunInput = {
  date: string;
  distance: number;
  type?: string | null;
  duration?: string | null;
  avgHr?: number | null;
  vo2Max?: number | null;
  shoe?: string | null;
  leftKneePain?: number | null;
  rightKneePain?: number | null;
  notes?: string | null;
};

/** Where a Run write leaves its week and Shoe. */
export type RunEffects = {
  /** The Run's Monday–Sunday week against its Mileage Cap, after the write. */
  week: WeekStanding;
  /** The Run's Shoe with its mileage after the write, or null if it has none. */
  shoe: Shoe | null;
};

/** What logging a Run returns: the Run, the Program and Phase its date falls in, and its week and Shoe. */
export type RunWrite = Attributed & RunEffects & { run: Run };

/** Records a Run. Fails if no Phase covers its date, or its Shoe is unknown or retired by then. */
export async function logRun(db: D1Database, input: RunInput): Promise<RunWrite> {
  const fields = await checkFields(db, mergeFields(emptyFields(input), input));
  const columns = Object.keys(fields);
  const row = await db
    .prepare(`INSERT INTO runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`)
    .bind(...Object.values(fields))
    .first<{ id: number }>();
  return written(db, await getRun(db, row!.id));
}

/** A correction to a Run: omitted fields are kept, and null clears an optional one. */
export type RunCorrection = Partial<RunInput> & { id: number };

/** What a correction returns: also the week and Shoe the Run moved out of, if it did. */
export type RunCorrectionWrite = RunWrite & {
  movedFrom: {
    /** The week the Run was in, if the correction moved it to another week. */
    week: WeekStanding | null;
    /** The Shoe the Run was worn in, if the correction changed or removed it. */
    shoe: Shoe | null;
  };
};

/**
 * Corrects a Run, e.g. a wrong distance, Shoe or date. The same rules as
 * logging apply to the corrected Run. Fails if there's no Run with the id.
 */
export async function updateRun(db: D1Database, correction: RunCorrection): Promise<RunCorrectionWrite> {
  const { id, ...changes } = correction;
  const before = await getRunFields(db, id);
  const fields = await checkFields(db, mergeFields(before, changes));
  const columns = Object.keys(fields);
  await db
    .prepare(`UPDATE runs SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
    .bind(...Object.values(fields), id)
    .run();
  const write = await written(db, await getRun(db, id));
  const oldWeek = weekOf(before.date);
  const movedWeek = oldWeek.start !== write.week.start;
  const movedShoe = before.shoe_id !== null && before.shoe_id !== fields.shoe_id;
  return {
    ...write,
    movedFrom: {
      week: movedWeek ? await weekStanding(db, oldWeek.start) : null,
      shoe: movedShoe ? await getShoe(db, before.shoe_id!) : null,
    },
  };
}

/**
 * Deletes a Run logged by mistake. Returns the deleted Run, and its week and
 * Shoe as they stand without it. Fails if there's no Run with the id.
 */
export async function deleteRun(db: D1Database, id: number): Promise<RunEffects & { deleted: Run }> {
  const run = await getRun(db, id);
  await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  return { deleted: run, ...(await effects(db, run)) };
}

/**
 * Runs dated from `from` to `to` (both included, either optional), newest
 * first, at most `limit` of them. For recent Runs, pass today's local date as
 * `to`.
 */
export async function listRuns(
  db: D1Database,
  { from, to, limit }: { from?: string; to?: string; limit?: number } = {},
): Promise<Run[]> {
  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (from !== undefined) {
    conditions.push("date >= ?");
    binds.push(parseDate(from, "from"));
  }
  if (to !== undefined) {
    conditions.push("date <= ?");
    binds.push(parseDate(to, "to"));
  }
  let sql = `SELECT * FROM runs ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY date DESC, id DESC`;
  if (limit !== undefined) {
    sql += " LIMIT ?";
    binds.push(limit);
  }
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<RunRow>();
  return results.map(toRun);
}

/** The Run with `id`. Fails if there's none. */
export async function getRun(db: D1Database, id: number): Promise<Run> {
  return toRun({ id, ...(await getRunFields(db, id)) });
}

async function written(db: D1Database, run: Run): Promise<RunWrite> {
  return { run, ...(await attribute(db, run.date)), ...(await effects(db, run)) };
}

async function effects(db: D1Database, run: Run): Promise<RunEffects> {
  return {
    week: await weekStanding(db, run.date),
    shoe: run.shoe === null ? null : await getShoe(db, run.shoe),
  };
}

type RunRow = {
  id: number;
  date: string;
  type: string | null;
  distance_miles: number;
  duration_seconds: number | null;
  avg_hr: number | null;
  vo2_max: number | null;
  shoe_id: string | null;
  left_knee_pain: number | null;
  right_knee_pain: number | null;
  notes: string | null;
};

/** A Run's stored fields: everything but its id. */
type RunFields = Omit<RunRow, "id">;

function emptyFields({ date, distance }: RunInput): RunFields {
  return {
    date,
    type: null,
    distance_miles: distance,
    duration_seconds: null,
    avg_hr: null,
    vo2_max: null,
    shoe_id: null,
    left_knee_pain: null,
    right_knee_pain: null,
    notes: null,
  };
}

/** `base` with `changes` applied: omitted fields are kept, and null clears one. */
function mergeFields(base: RunFields, changes: Partial<RunInput>): RunFields {
  const pick = <T>(change: T | null | undefined, current: T | null): T | null =>
    change === undefined ? current : change;
  const duration = changes.duration;
  return {
    date: changes.date ?? base.date,
    type: changes.type === undefined ? base.type : optionalText(changes.type),
    distance_miles: changes.distance ?? base.distance_miles,
    duration_seconds: duration === undefined ? base.duration_seconds : duration === null ? null : parseDuration(duration),
    avg_hr: pick(changes.avgHr, base.avg_hr),
    vo2_max: pick(changes.vo2Max, base.vo2_max),
    shoe_id: changes.shoe === undefined ? base.shoe_id : optionalText(changes.shoe),
    left_knee_pain: pick(changes.leftKneePain, base.left_knee_pain),
    right_knee_pain: pick(changes.rightKneePain, base.right_knee_pain),
    notes: changes.notes === undefined ? base.notes : optionalText(changes.notes),
  };
}

async function getRunFields(db: D1Database, id: number): Promise<RunFields> {
  const row = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(id).first<RunRow>();
  if (!row) notFound("Run", id);
  const { id: _, ...fields } = row;
  return fields;
}

const RATING = { min: 0, max: 10 };

/**
 * Returns `fields` if they make a valid Run, or fails with the reason: no
 * Phase covers the date, the Shoe is unknown or retired by then, or a measure
 * is out of range.
 */
async function checkFields(db: D1Database, fields: RunFields): Promise<RunFields> {
  parseDate(fields.date);
  if (!(Number.isFinite(fields.distance_miles) && fields.distance_miles > 0)) {
    throw new DomainError(`distance must be more than 0 miles, not ${fields.distance_miles}.`);
  }
  checkNumber(fields.avg_hr, "avgHr", { min: 1, max: 250, integer: true });
  checkNumber(fields.vo2_max, "vo2Max", { min: 1, max: 100 });
  checkNumber(fields.left_knee_pain, "leftKneePain", RATING);
  checkNumber(fields.right_knee_pain, "rightKneePain", RATING);
  await attribute(db, fields.date);
  if (fields.shoe_id !== null) await checkShoeForRun(db, fields.shoe_id, fields.date);
  return fields;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    distance: row.distance_miles,
    duration: row.duration_seconds === null ? null : formatDuration(row.duration_seconds),
    pace: row.duration_seconds === null ? null : formatDuration(row.duration_seconds / row.distance_miles),
    avgHr: row.avg_hr,
    vo2Max: row.vo2_max,
    shoe: row.shoe_id,
    leftKneePain: row.left_knee_pain,
    rightKneePain: row.right_knee_pain,
    notes: row.notes,
  };
}

/**
 * Seconds from an `h:mm:ss` or `m:ss` duration. Fails naming the `field` if
 * it isn't one, or is zero.
 */
export function parseDuration(value: string, field = "duration"): number {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  const invalid = new DomainError(`${field} "${value}" isn't a duration. Use h:mm:ss or m:ss, e.g. 1:05:30 or 27:45.`);
  if (!match) throw invalid;
  const [hours, minutes, seconds] = [match[1] ?? "0", match[2]!, match[3]!].map(Number) as [number, number, number];
  if (seconds > 59 || (match[1] !== undefined && minutes > 59)) throw invalid;
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total === 0) throw new DomainError(`${field} "${value}" is zero. Use h:mm:ss or m:ss, e.g. 27:45.`);
  return total;
}

/** `h:mm:ss`, or `m:ss` under an hour, to the nearest second. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
