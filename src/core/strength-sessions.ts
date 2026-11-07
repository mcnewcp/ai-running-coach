import { parseDate } from "./calendar";
import { DomainError } from "./errors";
import { attribute, type Attributed, checkNumber, notFound, optionalText, requiredText } from "./records";

// Strength Sessions: one completed gym session, made up of one entry per
// exercise performed. Belongs to a Phase by its date (ADR 0003).

export type ExerciseEntry = {
  /** The movement pattern, e.g. Squat, Hinge, Push, Pull. */
  pattern: string | null;
  exercise: string;
  load: number | null;
  /** What the load means, e.g. "per hand", "total", "bodyweight". */
  loadBasis: string | null;
  sets: number | null;
  /** Free text, e.g. "10", "8 each side", "30 s". */
  repsPerSet: string | null;
  notes: string | null;
};

export type StrengthSession = {
  id: number;
  date: string;
  /** e.g. Upper, Lower or Mix. */
  sessionType: string | null;
  notes: string | null;
  entries: ExerciseEntry[];
};

export type ExerciseEntryInput = {
  pattern?: string | null;
  exercise: string;
  load?: number | null;
  loadBasis?: string | null;
  sets?: number | null;
  repsPerSet?: string | null;
  notes?: string | null;
};

export type StrengthSessionInput = {
  date: string;
  sessionType?: string | null;
  notes?: string | null;
  entries: ExerciseEntryInput[];
};

export type StrengthSessionCorrection = {
  id: number;
  date?: string;
  /** Omit to keep; null clears. */
  sessionType?: string | null;
  /** Omit to keep; null clears. */
  notes?: string | null;
  /** The whole list of entries, replacing the current one. Omit to keep it. */
  entries?: ExerciseEntryInput[];
};

export type StrengthSessionWrite = Attributed & { strengthSession: StrengthSession };

/** Records a Strength Session. Fails if no Phase covers its date. */
export async function logStrengthSession(db: D1Database, input: StrengthSessionInput): Promise<StrengthSessionWrite> {
  const session = toSession(0, input);
  const attributed = await attribute(db, session.date);
  // One transaction: the new session has the highest id, so its entries can find it.
  const [inserted] = await db.batch([
    db
      .prepare("INSERT INTO strength_sessions (date, session_type, notes) VALUES (?, ?, ?) RETURNING id")
      .bind(session.date, session.sessionType, session.notes),
    ...insertEntries(db, "(SELECT MAX(id) FROM strength_sessions)", session.entries),
  ]);
  session.id = (inserted!.results[0] as { id: number }).id;
  return { strengthSession: session, ...attributed };
}

/**
 * Corrects a Strength Session. Fields left out keep their value; `entries`,
 * if given, replaces the whole list. Fails if no Phase covers the new date.
 */
export async function updateStrengthSession(
  db: D1Database,
  correction: StrengthSessionCorrection,
): Promise<StrengthSessionWrite> {
  const current = await loadSession(db, correction.id);
  const session = toSession(current.id, {
    date: correction.date ?? current.date,
    sessionType: correction.sessionType === undefined ? current.sessionType : correction.sessionType,
    notes: correction.notes === undefined ? current.notes : correction.notes,
    entries: correction.entries ?? current.entries,
  });
  const attributed = await attribute(db, session.date);
  await db.batch([
    db
      .prepare("UPDATE strength_sessions SET date = ?, session_type = ?, notes = ? WHERE id = ?")
      .bind(session.date, session.sessionType, session.notes, session.id),
    db.prepare("DELETE FROM exercise_entries WHERE session_id = ?").bind(session.id),
    ...insertEntries(db, "?", session.entries, session.id),
  ]);
  return { strengthSession: session, ...attributed };
}

/** Deletes a Strength Session and its entries. Returns what was deleted. */
export async function deleteStrengthSession(db: D1Database, id: number): Promise<{ deleted: StrengthSession }> {
  const session = await loadSession(db, id);
  await db.prepare("DELETE FROM strength_sessions WHERE id = ?").bind(id).run();
  return { deleted: session };
}

function toSession(id: number, input: StrengthSessionInput): StrengthSession {
  if (input.entries.length === 0) {
    throw new DomainError("A Strength Session needs at least one exercise entry.");
  }
  return {
    id,
    date: parseDate(input.date),
    sessionType: optionalText(input.sessionType),
    notes: optionalText(input.notes),
    entries: input.entries.map((entry, index) => {
      const which = `Entry ${index + 1}`;
      return {
        pattern: optionalText(entry.pattern),
        exercise: requiredText(entry.exercise, `${which}'s exercise`),
        load: checkNumber(entry.load, `${which}'s load`),
        loadBasis: optionalText(entry.loadBasis),
        sets: checkNumber(entry.sets, `${which}'s sets`, { min: 1, integer: true }),
        repsPerSet: optionalText(entry.repsPerSet),
        notes: optionalText(entry.notes),
      };
    }),
  };
}

// --- Storage -----------------------------------------------------------------

type SessionRow = { id: number; date: string; session_type: string | null; notes: string | null };

type EntryRow = {
  pattern: string | null;
  exercise: string;
  load: number | null;
  load_basis: string | null;
  sets: number | null;
  reps_per_set: string | null;
  notes: string | null;
};

async function loadSession(db: D1Database, id: number): Promise<StrengthSession> {
  const row = await db.prepare("SELECT * FROM strength_sessions WHERE id = ?").bind(id).first<SessionRow>();
  if (!row) notFound("Strength Session", id);
  const entries = await db
    .prepare("SELECT * FROM exercise_entries WHERE session_id = ? ORDER BY position")
    .bind(id)
    .all<EntryRow>();
  return {
    id: row.id,
    date: row.date,
    sessionType: row.session_type,
    notes: row.notes,
    entries: entries.results.map((entry) => ({
      pattern: entry.pattern,
      exercise: entry.exercise,
      load: entry.load,
      loadBasis: entry.load_basis,
      sets: entry.sets,
      repsPerSet: entry.reps_per_set,
      notes: entry.notes,
    })),
  };
}

/**
 * Inserts `entries` for the session `sessionId` names: an SQL expression, with
 * its parameters in `params`.
 */
function insertEntries(
  db: D1Database,
  sessionId: string,
  entries: ExerciseEntry[],
  ...params: unknown[]
): D1PreparedStatement[] {
  return entries.map((entry, position) =>
    db
      .prepare(
        `INSERT INTO exercise_entries
           (session_id, position, pattern, exercise, load, load_basis, sets, reps_per_set, notes)
         VALUES (${sessionId}, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ...params,
        position,
        entry.pattern,
        entry.exercise,
        entry.load,
        entry.loadBasis,
        entry.sets,
        entry.repsPerSet,
        entry.notes,
      ),
  );
}
