import { addDays, parseDate } from "./calendar";
import { checkPath } from "./documents";
import { DomainError } from "./errors";

// Programs and Phases: how the season is structured. Programs tile the
// calendar and Phases tile their Program, so every day belongs to exactly one
// Phase. Membership is always derived from the date (ADR 0003): `placeDate`
// and `findPlacement` are how any record finds its Phase and Program.

export const PROGRAM_KINDS = ["race_build", "bridge"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];

export const PHASE_KINDS = ["training", "race"] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

/** A date window, both ends included. */
type Window = { startDate: string; endDate: string };

export type Phase = Window & {
  name: string;
  /** race: the one-day Race Phase on a race build's A-race day. */
  kind: PhaseKind;
  focus: string | null;
  /** Free text, e.g. "20-25 mi/wk". */
  mileageTarget: string | null;
  /**
   * The vault path of the Phase's Plan, the document describing its intended
   * training, or null if none is linked. The document may not exist yet.
   */
  planPath: string | null;
};

export type ARace = { name: string; date: string };

export type Program = Window & {
  name: string;
  kind: ProgramKind;
  /** The race a race build exists for, on its last day. Bridge Programs have none. */
  aRace: ARace | null;
  phases: Phase[];
};

/** Where a date sits in the season structure. */
export type Placement = {
  date: string;
  program: Omit<Program, "phases">;
  phase: Phase;
};

export type PhaseInput = Window & {
  name: string;
  kind?: PhaseKind;
  focus?: string | null;
  mileageTarget?: string | null;
  /** Omit to keep the Plan of the existing Phase with this name, if any; null clears it. */
  planPath?: string | null;
};

export type ProgramInput = Window & {
  name: string;
  kind: ProgramKind;
  aRace?: ARace | null;
  /** The whole Phase layout. Required for a new Program; if omitted, the existing Phases are kept. */
  phases?: PhaseInput[];
  /** true to let the change move neighbouring Programs' edges. Without it, such a change is rejected. */
  moveNeighbours?: boolean;
};

export type UpsertPhaseInput = Window & {
  /** The name of the Program the Phase belongs to. */
  program: string;
  name: string;
  /** Omit to keep the current value (training for a new Phase). */
  kind?: PhaseKind;
  /** Omit to keep the current value; null clears it. */
  focus?: string | null;
  /** Omit to keep the current value; null clears it. */
  mileageTarget?: string | null;
  /** Omit to keep the current value; null clears it. */
  planPath?: string | null;
  /** true to let the change move neighbouring Phases' edges. Without it, such a change is rejected. */
  moveNeighbours?: boolean;
};

// --- Resolving dates -------------------------------------------------------

/**
 * The Program and Phase `date` falls in, or null if no Phase covers it. Use
 * it to attribute any dated record.
 */
export async function findPlacement(db: D1Database, date: string): Promise<Placement | null> {
  parseDate(date);
  const row = await db
    .prepare(
      `SELECT program_id FROM phases WHERE start_date <= ?1 AND end_date >= ?1 LIMIT 1`,
    )
    .bind(date)
    .first<{ program_id: number }>();
  if (!row) return null;
  const program = (await loadPrograms(db, "WHERE id = ?", [row.program_id]))[0]!;
  const phase = program.phases.find((p) => contains(p, date))!;
  const { phases: _, ...programOnly } = program;
  return { date, program: programOnly, phase };
}

/**
 * The Program and Phase `date` falls in. Fails with a clear message if no
 * Phase covers it: use it to validate a dated record before writing it.
 */
export async function placeDate(db: D1Database, date: string): Promise<Placement> {
  const placement = await findPlacement(db, date);
  if (placement) return placement;
  const span = await db
    .prepare("SELECT MIN(start_date) AS first, MAX(end_date) AS last FROM programs")
    .first<{ first: string | null; last: string | null }>();
  const covered = span?.first
    ? `Programs cover ${span.first} to ${span.last}.`
    : "There are no Programs yet.";
  throw new DomainError(`No Phase covers ${date}. ${covered} Add or extend a Program with upsert_program first.`);
}

/** Every Program, with its Phases, in date order. */
export async function listPrograms(db: D1Database): Promise<Program[]> {
  return loadPrograms(db);
}

/** The Program named `name`, with its Phases, or null if there's none. */
export async function findProgram(db: D1Database, name: string): Promise<Program | null> {
  return (await loadPrograms(db, "WHERE name = ?", [name]))[0] ?? null;
}

// --- Changing the structure --------------------------------------------------

/**
 * Creates or changes a Program (matched by name), with its whole Phase
 * layout if given. A new Program must meet the existing ones without
 * overlapping them. If an existing Program's window changes so that the
 * Programs either side would have to move to keep meeting it, the change is
 * rejected, naming what would move, unless `moveNeighbours` is set: then
 * their adjoining edge, and the Phase on that edge, move with it.
 * Fails if the result would leave a gap or overlap, or break a Program's
 * layout rules. Returns the Program and any neighbours that moved.
 */
export async function upsertProgram(
  db: D1Database,
  input: ProgramInput,
): Promise<{ program: Program; adjusted: Program[] }> {
  const window = parseWindow(input, `Program ${input.name}`);
  const aRace = parseARace(input);
  const all = await loadPrograms(db);
  const existing = all.find((p) => p.name === input.name) ?? null;

  let phases: Phase[];
  if (input.phases) {
    const previous = existing?.phases ?? [];
    phases = input.phases.map((phase) => toPhase(phase, previous.find((p) => p.name === phase.name))).sort(byStart);
  } else if (existing) {
    phases = moveEdges(existing.phases, window);
  } else {
    throw new DomainError(`Program ${input.name} is new, so give its Phases: every day of it must belong to one.`);
  }

  const program: Program = { name: input.name, kind: input.kind, ...window, aRace, phases };
  checkLayout(program);

  const others = all.filter((p) => p !== existing);
  // A new Program never reshapes others: it has to fit against them as they are.
  const fitted = existing ? fitAmong(others, existing, program, "Program") : others;
  const adjusted: Program[] = [];
  for (const [index, neighbour] of fitted.entries()) {
    const before = others[index]!;
    if (neighbour.startDate === before.startDate && neighbour.endDate === before.endDate) continue;
    if (neighbour.aRace && neighbour.endDate !== before.endDate) {
      throw new DomainError(
        `That would move the A-race day of Program ${neighbour.name} (${before.endDate}). ` +
          `Change ${neighbour.name} itself if its A-race has moved.`,
      );
    }
    const moved = { ...neighbour, phases: moveEdges(before.phases, neighbour) };
    checkLayout(moved, `To keep Programs tiling, Program ${moved.name} would become ${moved.startDate} to ${moved.endDate}, but then: `);
    adjusted.push(moved);
  }
  checkTiling([...fitted, program], "Program", "Programs tile the calendar: each starts the day after the one before it ends.");
  if (!input.moveNeighbours) {
    checkNoneMoved(
      adjusted.flatMap((moved) => {
        const before = others.find((p) => p.name === moved.name)!;
        return [
          ...edgeMoves(`Program ${moved.name}`, before, moved),
          ...moved.phases.flatMap((phase) =>
            edgeMoves(`Phase ${phase.name} (${moved.name})`, before.phases.find((p) => p.name === phase.name)!, phase),
          ),
        ];
      }),
    );
  }

  await savePrograms(db, [program, ...adjusted]);
  return { program, adjusted };
}

/**
 * Creates or changes one Phase (matched by name) of an existing Program. If
 * the Phases either side would have to move to keep meeting it, the change is
 * rejected, naming what would move, unless `moveNeighbours` is set: then one
 * it overlaps is trimmed, and one that met its old window is stretched to
 * meet the new one. Fails if the result would leave a gap or overlap, swallow
 * or split another Phase, or break the Program's layout rules. Returns the
 * whole Program and any neighbouring Phases that moved.
 */
export async function upsertPhase(
  db: D1Database,
  input: UpsertPhaseInput,
): Promise<{ program: Program; adjusted: Phase[] }> {
  const window = parseWindow(input, `Phase ${input.name}`);
  const program = (await loadPrograms(db, "WHERE name = ?", [input.program]))[0];
  if (!program) {
    throw new DomainError(`There's no Program named ${input.program}. Create it with upsert_program.`);
  }
  const existing = program.phases.find((p) => p.name === input.name) ?? null;
  const phase: Phase = {
    name: input.name,
    kind: input.kind ?? existing?.kind ?? "training",
    ...window,
    focus: input.focus === undefined ? (existing?.focus ?? null) : input.focus,
    mileageTarget: input.mileageTarget === undefined ? (existing?.mileageTarget ?? null) : input.mileageTarget,
    planPath: input.planPath === undefined ? (existing?.planPath ?? null) : parsePlanPath(input.planPath),
  };
  const others = program.phases.filter((p) => p !== existing);
  const fitted = fitAmong(others, existing, phase, "Phase");
  const changed = { ...program, phases: [...fitted, phase].sort(byStart) };
  checkLayout(changed);
  const moves = fitted.map((p, index) => edgeMoves(`Phase ${p.name}`, others[index]!, p));
  if (!input.moveNeighbours) checkNoneMoved(moves.flat());
  await savePrograms(db, [changed]);
  return { program: changed, adjusted: fitted.filter((_, index) => moves[index]!.length > 0) };
}

// --- Rules -------------------------------------------------------------------

/**
 * Places `target` among `siblings`, which tile without it, and returns the
 * siblings (same order) adjusted to keep meeting it. One it overlaps at an
 * edge is trimmed; one that met `previous` (its old window) is stretched to
 * meet the new one. The caller still checks the result tiles.
 */
function fitAmong<T extends Window & { name: string }>(
  siblings: T[],
  previous: Window | null,
  target: Window & { name: string },
  noun: "Program" | "Phase",
): T[] {
  return siblings.map((sibling) => {
    const fitted = { ...sibling };
    if (sibling.startDate >= target.startDate && sibling.endDate <= target.endDate) {
      throw new DomainError(
        `${noun} ${target.name} (${describe(target)}) would swallow ${noun} ${sibling.name} (${describe(sibling)}) entirely.` +
          (noun === "Phase" ? " To restructure the Phases, give the whole layout with upsert_program." : ""),
      );
    }
    if (sibling.startDate < target.startDate && sibling.endDate > target.endDate) {
      throw new DomainError(
        `${noun} ${target.name} (${describe(target)}) would split ${noun} ${sibling.name} (${describe(sibling)}) in two.` +
          (noun === "Phase" ? " To restructure the Phases, give the whole layout with upsert_program." : ""),
      );
    }
    if (sibling.startDate < target.startDate && sibling.endDate >= target.startDate) {
      fitted.endDate = addDays(target.startDate, -1);
    } else if (sibling.startDate <= target.endDate && sibling.endDate > target.endDate) {
      fitted.startDate = addDays(target.endDate, 1);
    } else if (previous && sibling.endDate === addDays(previous.startDate, -1)) {
      fitted.endDate = addDays(target.startDate, -1);
    } else if (previous && sibling.startDate === addDays(previous.endDate, 1)) {
      fitted.startDate = addDays(target.endDate, 1);
    }
    return fitted;
  });
}

/** How `what`'s window would move from `before` to `after`, one entry per edge. */
function edgeMoves(what: string, before: Window, after: Window): string[] {
  const moves: string[] = [];
  if (before.startDate !== after.startDate) moves.push(`${what}'s start from ${before.startDate} to ${after.startDate}`);
  if (before.endDate !== after.endDate) moves.push(`${what}'s end from ${before.endDate} to ${after.endDate}`);
  return moves;
}

/**
 * Fails, naming each move, if a change would move a neighbour's edge without
 * the caller opting in, so a typo can never reshape a neighbour silently.
 */
function checkNoneMoved(moves: string[]): void {
  if (moves.length === 0) return;
  throw new DomainError(
    `That would move ${moves.join("; ")}. Pass moveNeighbours: true to move ${moves.length === 1 ? "it" : "them"}, ` +
      "or choose a window that meets the neighbours as they are.",
  );
}

/**
 * The Phases of a Program whose window becomes `window`: the first and last
 * Phases stretch or shrink with it, and a Race Phase stays on the last day.
 */
function moveEdges(phases: Phase[], window: Window): Phase[] {
  const moved = phases.map((phase) => ({ ...phase })).sort(byStart);
  const first = moved[0];
  const last = moved.at(-1);
  if (!first || !last) return moved;
  first.startDate = window.startDate;
  if (last.kind === "race" && moved.length > 1) {
    last.startDate = last.endDate = window.endDate;
    moved.at(-2)!.endDate = addDays(window.endDate, -1);
  } else {
    last.endDate = window.endDate;
  }
  return moved;
}

/** Checks a Program's own layout: its Phases tile it, and the A-race rules. */
function checkLayout(program: Program, prefix = ""): void {
  const fail = (message: string) => {
    throw new DomainError(prefix + message);
  };
  const { phases } = program;
  if (phases.length === 0) fail(`Program ${program.name} needs at least one Phase.`);
  const names = new Set<string>();
  for (const phase of phases) {
    if (names.has(phase.name)) fail(`Program ${program.name} has two Phases named ${phase.name}.`);
    names.add(phase.name);
    if (phase.startDate > phase.endDate) fail(`Phase ${phase.name} would have no days (${describe(phase)}).`);
  }
  const sorted = [...phases].sort(byStart);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  if (first.startDate < program.startDate || last.endDate > program.endDate) {
    const outside = first.startDate < program.startDate ? first : last;
    fail(`Phase ${outside.name} (${describe(outside)}) falls outside Program ${program.name} (${describe(program)}).`);
  }
  if (first.startDate > program.startDate) {
    fail(`Nothing would cover ${describe({ startDate: program.startDate, endDate: addDays(first.startDate, -1) })}, the start of Program ${program.name}. Its Phases must cover every day of it.`);
  }
  if (last.endDate < program.endDate) {
    fail(`Nothing would cover ${describe({ startDate: addDays(last.endDate, 1), endDate: program.endDate })}, the end of Program ${program.name}. Its Phases must cover every day of it.`);
  }
  checkTiling(sorted, "Phase", `Phases tile their Program: each starts the day after the one before it ends.`, prefix);

  const racePhases = sorted.filter((p) => p.kind === "race");
  if (program.kind === "bridge") {
    if (racePhases.length > 0) fail(`Bridge Program ${program.name} has no A-race, so it can't have a Race Phase.`);
    return;
  }
  const rule = `A race-build Program's last Phase is a one-day Race Phase on its A-race day (${program.endDate}), and it has no other Race Phase.`;
  if (racePhases.length !== 1 || last.kind !== "race" || last.startDate !== program.endDate) {
    fail(`Program ${program.name} doesn't end with its Race Phase. ${rule}`);
  }
}

/** Checks that `windows` meet end to start, with no gap or overlap. */
function checkTiling(windows: (Window & { name: string })[], noun: string, rule: string, prefix = ""): void {
  const sorted = [...windows].sort(byStart);
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1]!;
    const after = sorted[i]!;
    if (after.startDate <= before.endDate) {
      throw new DomainError(
        `${prefix}${noun}s ${before.name} (${describe(before)}) and ${after.name} (${describe(after)}) would overlap. ${rule}`,
      );
    }
    if (after.startDate !== addDays(before.endDate, 1)) {
      throw new DomainError(
        `${prefix}That would leave a gap from ${addDays(before.endDate, 1)} to ${addDays(after.startDate, -1)}, ` +
          `between ${noun}s ${before.name} and ${after.name}. ${rule}`,
      );
    }
  }
}

function parseWindow(input: Window, what: string): Window {
  const startDate = parseDate(input.startDate, `${what}: startDate`);
  const endDate = parseDate(input.endDate, `${what}: endDate`);
  if (startDate > endDate) throw new DomainError(`${what} ends (${endDate}) before it starts (${startDate}).`);
  return { startDate, endDate };
}

function parseARace(input: ProgramInput): ARace | null {
  if (input.kind === "bridge") {
    if (input.aRace) throw new DomainError(`Program ${input.name} is a bridge, and bridge Programs have no A-race.`);
    return null;
  }
  if (!input.aRace) throw new DomainError(`Program ${input.name} is a race build, so it needs an A-race (name and date).`);
  const date = parseDate(input.aRace.date, `A-race ${input.aRace.name}: date`);
  if (date !== input.endDate) {
    throw new DomainError(
      `A race-build Program ends on its A-race day, but Program ${input.name} ends ${input.endDate} and its A-race is ${date}.`,
    );
  }
  return { name: input.aRace.name, date };
}

/**
 * A Phase from its input. `previous` is the existing Phase with the same
 * name, whose Plan it keeps unless the input says otherwise.
 */
function toPhase(input: PhaseInput, previous: Phase | undefined): Phase {
  return {
    name: input.name,
    kind: input.kind ?? "training",
    ...parseWindow(input, `Phase ${input.name}`),
    focus: input.focus ?? null,
    mileageTarget: input.mileageTarget ?? null,
    planPath: input.planPath === undefined ? (previous?.planPath ?? null) : parsePlanPath(input.planPath),
  };
}

/** A Plan's vault path, or null. Fails if it isn't a document path. */
function parsePlanPath(path: string | null): string | null {
  if (path === null) return null;
  checkPath(path);
  return path;
}

function contains(window: Window, date: string): boolean {
  return window.startDate <= date && date <= window.endDate;
}

function byStart(a: Window, b: Window): number {
  return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
}

function describe(window: Window): string {
  return window.startDate === window.endDate ? window.startDate : `${window.startDate} to ${window.endDate}`;
}

// --- Storage -----------------------------------------------------------------

type ProgramRow = {
  id: number;
  name: string;
  kind: ProgramKind;
  start_date: string;
  end_date: string;
  a_race_name: string | null;
};

type PhaseRow = {
  program_id: number;
  name: string;
  kind: PhaseKind;
  start_date: string;
  end_date: string;
  focus: string | null;
  mileage_target: string | null;
  plan_path: string | null;
};

async function loadPrograms(db: D1Database, where = "", params: unknown[] = []): Promise<Program[]> {
  const programs = await db
    .prepare(`SELECT * FROM programs ${where} ORDER BY start_date`)
    .bind(...params)
    .all<ProgramRow>();
  if (programs.results.length === 0) return [];
  const ids = programs.results.map((p) => p.id);
  const phases = await db
    .prepare(`SELECT * FROM phases WHERE program_id IN (${ids.map(() => "?").join(", ")}) ORDER BY start_date`)
    .bind(...ids)
    .all<PhaseRow>();
  return programs.results.map((row) => ({
    name: row.name,
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    aRace: row.a_race_name === null ? null : { name: row.a_race_name, date: row.end_date },
    phases: phases.results
      .filter((phase) => phase.program_id === row.id)
      .map((phase) => ({
        name: phase.name,
        kind: phase.kind,
        startDate: phase.start_date,
        endDate: phase.end_date,
        focus: phase.focus,
        mileageTarget: phase.mileage_target,
        planPath: phase.plan_path,
      })),
  }));
}

/** The dated records, as [table, singular, plural]. Each belongs to the Phase its date falls in. */
const DATED_RECORDS = [
  ["runs", "Run", "Runs"],
  ["strength_sessions", "Strength Session", "Strength Sessions"],
  ["check_ins", "Daily Check-in", "Daily Check-ins"],
  ["body_comp_scans", "Body-comp Scan", "Body-comp Scans"],
  ["race_results", "Race Result", "Race Results"],
] as const;

/**
 * Fails if writing `changed` would leave a record that a Phase covers now
 * dated outside every Phase, saying how many of each kind and their dates.
 * Programs tile the calendar and Phases tile their Program, so the Phases
 * cover exactly the days from the first Program's start to the last's end.
 */
async function checkNothingStranded(db: D1Database, changed: Program[]): Promise<void> {
  const { results } = await db
    .prepare("SELECT name, start_date AS startDate, end_date AS endDate FROM programs")
    .all<Window & { name: string }>();
  if (results.length === 0) return;
  const span = (windows: Window[]) => ({
    startDate: windows.map((w) => w.startDate).reduce((a, b) => (a < b ? a : b)),
    endDate: windows.map((w) => w.endDate).reduce((a, b) => (a > b ? a : b)),
  });
  const before = span(results);
  const after = span([...results.filter((p) => !changed.some((c) => c.name === p.name)), ...changed]);
  const { results: stranded } = await db
    .prepare(
      DATED_RECORDS.map(
        ([table], index) =>
          `SELECT ${index} AS kind, COUNT(*) AS count, MIN(date) AS first, MAX(date) AS last FROM ${table}
           WHERE date BETWEEN ?1 AND ?2 AND (date < ?3 OR date > ?4)`,
      ).join(" UNION ALL "),
    )
    .bind(before.startDate, before.endDate, after.startDate, after.endDate)
    .all<{ kind: number; count: number; first: string | null; last: string | null }>();
  const found = stranded.filter((row) => row.count > 0).sort((a, b) => a.kind - b.kind);
  if (found.length === 0) return;
  const counts = found.map(({ kind, count }) => {
    const [, singular, plural] = DATED_RECORDS[kind]!;
    return `${count} ${count === 1 ? singular : plural}`;
  });
  const dates = span(found.map((row) => ({ startDate: row.first!, endDate: row.last! })));
  throw new DomainError(
    `That would leave records dated outside every Phase: ${counts.join(", ")}, from ${describe(dates)}. ` +
      "Keep their dates covered, or correct or delete those records first.",
  );
}

/**
 * Writes Programs and their whole Phase layouts, all or nothing. Fails,
 * writing nothing, if that would strand a record outside every Phase.
 */
async function savePrograms(db: D1Database, programs: Program[]): Promise<void> {
  await checkNothingStranded(db, programs);
  const programId = "(SELECT id FROM programs WHERE name = ?)";
  await db.batch(
    programs.flatMap((program) => [
      db
        .prepare(
          `INSERT INTO programs (name, kind, start_date, end_date, a_race_name) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET kind = excluded.kind, start_date = excluded.start_date,
             end_date = excluded.end_date, a_race_name = excluded.a_race_name`,
        )
        .bind(program.name, program.kind, program.startDate, program.endDate, program.aRace?.name ?? null),
      db.prepare(`DELETE FROM phases WHERE program_id = ${programId}`).bind(program.name),
      ...program.phases.map((phase) =>
        db
          .prepare(
            `INSERT INTO phases (program_id, name, kind, start_date, end_date, focus, mileage_target, plan_path)
             VALUES (${programId}, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            program.name,
            phase.name,
            phase.kind,
            phase.startDate,
            phase.endDate,
            phase.focus,
            phase.mileageTarget,
            phase.planPath,
          ),
      ),
    ]),
  );
}
