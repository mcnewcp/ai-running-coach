import { parseDate, weekOf } from "./calendar";
import { formatDuration, parseDuration } from "./durations";
import { DomainError } from "./errors";
import { type WeekStanding, weekStanding } from "./mileage-cap";
import { attribute, type Attributed, checkNumber, HEART_RATE, merge, notFound, optionalText, RATING } from "./records";
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
  const fields = await checkFields(db, merge<RunFields>({ date: input.date, distance: input.distance, ...EMPTY }, input));
  const row = toRow(fields);
  const columns = Object.keys(row);
  const inserted = await db
    .prepare(`INSERT INTO runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`)
    .bind(...Object.values(row))
    .first<{ id: number }>();
  return written(db, await getRun(db, inserted!.id));
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
  const { id: _, pace: __, ...before } = await getRun(db, id);
  const fields = await checkFields(db, merge(before, changes));
  const row = toRow(fields);
  const columns = Object.keys(row);
  await db
    .prepare(`UPDATE runs SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
    .bind(...Object.values(row), id)
    .run();
  const write = await written(db, await getRun(db, id));
  const oldWeek = weekOf(before.date);
  const movedWeek = oldWeek.start !== write.week.start;
  const movedShoe = before.shoe !== null && before.shoe !== fields.shoe;
  return {
    ...write,
    movedFrom: {
      week: movedWeek ? await weekStanding(db, oldWeek.start) : null,
      shoe: movedShoe ? await getShoe(db, before.shoe!) : null,
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
  const row = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(id).first<RunRow>();
  if (!row) notFound("Run", id);
  return toRun(row);
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

/** A Run's own fields, as reported: everything but its id and its derived pace. */
type RunFields = Omit<Run, "id" | "pace">;

const EMPTY = {
  type: null,
  duration: null,
  avgHr: null,
  vo2Max: null,
  shoe: null,
  leftKneePain: null,
  rightKneePain: null,
  notes: null,
} satisfies Omit<RunFields, "date" | "distance">;

/**
 * Returns `fields`, normalised, if they make a valid Run, or fails with the
 * reason: no Phase covers the date, the Shoe is unknown or retired by then,
 * or a measure is out of range.
 */
async function checkFields(db: D1Database, fields: RunFields): Promise<RunFields> {
  parseDate(fields.date);
  if (!(Number.isFinite(fields.distance) && fields.distance > 0)) {
    throw new DomainError(`distance must be more than 0 miles, not ${fields.distance}.`);
  }
  const checked: RunFields = {
    date: fields.date,
    type: optionalText(fields.type),
    distance: fields.distance,
    duration: fields.duration === null ? null : formatDuration(parseDuration(fields.duration, "duration")),
    avgHr: checkNumber(fields.avgHr, "avgHr", HEART_RATE),
    vo2Max: checkNumber(fields.vo2Max, "vo2Max", { min: 1, max: 100 }),
    shoe: optionalText(fields.shoe),
    leftKneePain: checkNumber(fields.leftKneePain, "leftKneePain", RATING),
    rightKneePain: checkNumber(fields.rightKneePain, "rightKneePain", RATING),
    notes: optionalText(fields.notes),
  };
  await attribute(db, checked.date);
  if (checked.shoe !== null) await checkShoeForRun(db, checked.shoe, checked.date);
  return checked;
}

function toRow(fields: RunFields): Omit<RunRow, "id"> {
  return {
    date: fields.date,
    type: fields.type,
    distance_miles: fields.distance,
    duration_seconds: fields.duration === null ? null : parseDuration(fields.duration, "duration"),
    avg_hr: fields.avgHr,
    vo2_max: fields.vo2Max,
    shoe_id: fields.shoe,
    left_knee_pain: fields.leftKneePain,
    right_knee_pain: fields.rightKneePain,
    notes: fields.notes,
  };
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
