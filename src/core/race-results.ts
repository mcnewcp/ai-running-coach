import { parseDate } from "./calendar";
import { checkPath } from "./documents";
import { formatDuration, parseDuration } from "./durations";
import { placeDate } from "./programs";
import { type Attributed, checkNumber, HEART_RATE, merge, notFound, optionalText, requiredText } from "./records";

// Race Results: the official outcome of one race, linked to its narrative
// document. Belongs to a Phase by its date (ADR 0003). Whether it's an A-race
// or a Tune-up Race is derived from the Programs, and PRs are derived from
// Race Results: neither is ever stored.

/** a_race: the A-race a Program names (on its last day, by name). tune_up: any other race. */
export type RaceKind = "a_race" | "tune_up";

export type RaceResult = {
  id: number;
  kind: RaceKind;
  date: string;
  name: string;
  /** The distance as named, e.g. 5K, 10K, Half Marathon. PRs are per distance. */
  distance: string;
  /** H:MM:SS, or M:SS under an hour. */
  officialTime: string;
  pace: string | null;
  conditions: string | null;
  avgHr: number | null;
  placement: string | null;
  /** The vault path of the race narrative. */
  narrativePath: string | null;
  notes: string | null;
};

type Fields = Omit<RaceResult, "id" | "kind">;

export type RaceResultInput = Pick<Fields, "date" | "name" | "distance" | "officialTime"> &
  Partial<{ [K in keyof Fields]: Fields[K] | null }>;

/** Fields left out keep their value; null clears an optional one. */
export type RaceResultCorrection = { id: number } & Partial<{ [K in keyof Fields]: Fields[K] | null }>;

export type RaceResultWrite = Attributed & { raceResult: RaceResult };

/** The fastest Race Result at one distance. */
export type PR = { distance: string; raceResult: RaceResult };

const EMPTY = { pace: null, conditions: null, avgHr: null, placement: null, narrativePath: null, notes: null };

/** Records a Race Result. Fails if no Phase covers its date. */
export async function logRaceResult(db: D1Database, input: RaceResultInput): Promise<RaceResultWrite> {
  const result = check(merge<Fields>({ ...input, ...EMPTY }, input));
  const { program, phase } = await placeDate(db, result.date);
  const row = await db
    .prepare(
      `INSERT INTO race_results (date, name, distance, official_time_seconds, pace, conditions, avg_hr,
         placement, narrative_path, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(...values(result))
    .first<{ id: number }>();
  return { raceResult: await loadResult(db, row!.id), program, phase };
}

/** Corrects a Race Result. Fails if no Phase covers the new date. */
export async function updateRaceResult(db: D1Database, correction: RaceResultCorrection): Promise<RaceResultWrite> {
  const { id, kind: _, ...current } = await loadResult(db, correction.id);
  const { id: __, ...changes } = correction;
  const result = check(merge(current, changes));
  const { program, phase } = await placeDate(db, result.date);
  await db
    .prepare(
      `UPDATE race_results SET date = ?, name = ?, distance = ?, official_time_seconds = ?, pace = ?,
         conditions = ?, avg_hr = ?, placement = ?, narrative_path = ?, notes = ?
       WHERE id = ?`,
    )
    .bind(...values(result), id)
    .run();
  return { raceResult: await loadResult(db, id), program, phase };
}

/** Deletes a Race Result. Returns what was deleted. */
export async function deleteRaceResult(db: D1Database, id: number): Promise<{ deleted: RaceResult }> {
  const result = await loadResult(db, id);
  await db.prepare("DELETE FROM race_results WHERE id = ?").bind(id).run();
  return { deleted: result };
}

/** Every Race Result, in date order. */
export async function listRaceResults(db: D1Database): Promise<RaceResult[]> {
  const { results } = await db.prepare(`${SELECT_RESULTS} ORDER BY date, id`).all<RaceResultRow>();
  return results.map(fromRow);
}

/**
 * The PR at each distance: its fastest Race Result, the earlier one on a tie.
 * Distances match ignoring case and spaces, so "5K" and "5 k" are one
 * distance. Sorted by distance.
 */
export async function listPRs(db: D1Database): Promise<{ prs: PR[] }> {
  const { results } = await db
    .prepare(`${SELECT_RESULTS} ORDER BY official_time_seconds, date, id`)
    .all<RaceResultRow>();
  const fastest = new Map<string, RaceResult>();
  for (const row of results) {
    const key = distanceKey(row.distance);
    if (!fastest.has(key)) fastest.set(key, fromRow(row));
  }
  const prs = [...fastest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, raceResult]) => ({ distance: raceResult.distance, raceResult }));
  return { prs };
}

function check(fields: Fields): Fields {
  const narrativePath = optionalText(fields.narrativePath);
  if (narrativePath !== null) checkPath(narrativePath);
  return {
    date: parseDate(fields.date),
    name: requiredText(fields.name, "name"),
    distance: requiredText(fields.distance, "distance"),
    officialTime: formatDuration(parseDuration(fields.officialTime, "officialTime")),
    pace: optionalText(fields.pace),
    conditions: optionalText(fields.conditions),
    avgHr: checkNumber(fields.avgHr, "avgHr", HEART_RATE),
    placement: optionalText(fields.placement),
    narrativePath,
    notes: optionalText(fields.notes),
  };
}

function distanceKey(distance: string): string {
  return distance.toLowerCase().replace(/\s+/g, "");
}

// --- Storage -----------------------------------------------------------------

/**
 * Every Race Result with whether a Program names it as its A-race: a race
 * build ends on its A-race day, and the names match ignoring case and
 * surrounding spaces.
 */
const SELECT_RESULTS = `SELECT r.*, EXISTS (
    SELECT 1 FROM programs p
    WHERE p.a_race_name IS NOT NULL AND p.end_date = r.date AND LOWER(TRIM(p.a_race_name)) = LOWER(TRIM(r.name))
  ) AS is_a_race
  FROM race_results r`;

type RaceResultRow = {
  id: number;
  date: string;
  name: string;
  distance: string;
  official_time_seconds: number;
  pace: string | null;
  conditions: string | null;
  avg_hr: number | null;
  placement: string | null;
  narrative_path: string | null;
  notes: string | null;
  is_a_race: number;
};

function values(result: Fields): unknown[] {
  return [
    result.date,
    result.name,
    result.distance,
    parseDuration(result.officialTime, "officialTime"),
    result.pace,
    result.conditions,
    result.avgHr,
    result.placement,
    result.narrativePath,
    result.notes,
  ];
}

async function loadResult(db: D1Database, id: number): Promise<RaceResult> {
  const row = await db.prepare(`${SELECT_RESULTS} WHERE r.id = ?`).bind(id).first<RaceResultRow>();
  if (!row) notFound("Race Result", id);
  return fromRow(row);
}

function fromRow(row: RaceResultRow): RaceResult {
  return {
    id: row.id,
    kind: row.is_a_race ? "a_race" : "tune_up",
    date: row.date,
    name: row.name,
    distance: row.distance,
    officialTime: formatDuration(row.official_time_seconds),
    pace: row.pace,
    conditions: row.conditions,
    avgHr: row.avg_hr,
    placement: row.placement,
    narrativePath: row.narrative_path,
    notes: row.notes,
  };
}
