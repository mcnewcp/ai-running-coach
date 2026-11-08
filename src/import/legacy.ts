import type { BodyCompScanInput } from "../core/body-comp-scans";
import type { CheckInInput } from "../core/check-ins";
import type { RaceResultInput } from "../core/race-results";
import type { RunInput } from "../core/runs";
import type { StrengthSessionInput } from "../core/strength-sessions";
import { type ArchiveSource, readRequired } from "./archive";
import { parseCsv } from "./csv";
import { type Excerpt, relevel } from "./markdown";

// Readers for the archive's legacy files. Each turns a file into the inputs
// the domain core takes, keeping where every record came from so the report
// can point at it. They read the files' shape only: nothing here knows about
// one runner's data.

export const RUNS_PATH = "data/runs.csv";
export const PREBUILD_RUNS_PATH = "extraction/prebuild-runs.csv";
export const SHOE_LOG_PATH = "data/shoes.md";
export const LIFTS_PATH = "data/lifts.csv";
export const INBODY_PATH = "data/inbody.csv";
export const CHECK_INS_PATH = "extraction/daily-check-ins.csv";
export const RACE_HISTORY_PATH = "data/race-history.md";

/** A record read from the archive: its input for the core, and where it came from. */
export type Sourced<T> = {
  /** File and line, e.g. "data/runs.csv:12". */
  source: string;
  /** The legacy free-text training_goal labels on its rows, with where each is. */
  labels: { source: string; label: string }[];
  /** Something the runner should look at, though the record can be imported. */
  warning?: string | undefined;
  input: T;
};

/** Every Run: the legacy runs.csv, then the reviewed pre-build Runs. */
export function readRuns(archive: ArchiveSource): Sourced<RunInput>[] {
  return [RUNS_PATH, PREBUILD_RUNS_PATH].flatMap((path) =>
    parseCsv(readRequired(archive, path)).map(({ line, values }) => ({
      source: `${path}:${line}`,
      labels: labelAt(`${path}:${line}`, values.training_goal),
      input: {
        date: values.date?.trim() ?? "",
        distance: Number(values.distance_mi),
        type: text(values.type),
        duration: text(values.duration),
        avgHr: number(values.avg_hr),
        vo2Max: number(values.vo2max),
        shoe: text(values.shoes),
        leftKneePain: number(values.knee_pain_l),
        rightKneePain: number(values.knee_pain_r),
        notes: text(values.notes),
      },
    })),
  );
}

/**
 * The Strength Sessions in lifts.csv, which has one row per exercise: the
 * rows sharing a date and session type make one session, in file order.
 */
export function readStrengthSessions(archive: ArchiveSource): Sourced<StrengthSessionInput>[] {
  const sessions = new Map<string, Sourced<StrengthSessionInput>>();
  for (const { line, values } of parseCsv(readRequired(archive, LIFTS_PATH))) {
    const date = values.date?.trim() ?? "";
    const sessionType = text(values.session);
    const key = `${date}|${sessionType ?? ""}`;
    let session = sessions.get(key);
    if (!session) {
      session = {
        source: `${LIFTS_PATH}:${line}`,
        labels: [],
        input: { date, sessionType, entries: [] },
      };
      sessions.set(key, session);
    }
    session.labels.push(...labelAt(`${LIFTS_PATH}:${line}`, values.training_goal));
    session.input.entries.push({
      pattern: text(values.pattern),
      exercise: values.exercise ?? "",
      load: number(values.load_lb),
      loadBasis: text(values.load_basis),
      sets: number(values.sets),
      repsPerSet: text(values.reps),
      notes: text(values.notes),
    });
  }
  return [...sessions.values()];
}

/**
 * The Body-comp Scans in inbody.csv. Its ECW/TBW ratio has no column of its
 * own (it isn't total body water), so it's kept in the notes.
 */
export function readBodyCompScans(archive: ArchiveSource): Sourced<BodyCompScanInput>[] {
  return parseCsv(readRequired(archive, INBODY_PATH)).map(({ line, values }) => {
    const ratio = text(values.ecw_tbw);
    return {
      source: `${INBODY_PATH}:${line}`,
      labels: [],
      input: {
        date: values.date?.trim() ?? "",
        weight: number(values.weight_lb),
        skeletalMuscleMass: number(values.skeletal_muscle_mass_lb),
        bodyFatPercent: number(values.percent_body_fat),
        bodyFatMass: number(values.body_fat_mass_lb),
        bmi: number(values.bmi),
        visceralFatLevel: number(values.visceral_fat_level),
        basalMetabolicRate: number(values.basal_metabolic_rate_kcal),
        notes: clauses(text(values.notes), ratio && `ECW/TBW: ${ratio}`),
      },
    };
  });
}

/**
 * The reviewed Daily Check-ins. The extraction records sleep quality as a
 * word; `sleepScale` rates each word 0-10. A word it doesn't rate stays in the
 * notes, with a warning.
 */
export function readCheckIns(archive: ArchiveSource, sleepScale: Record<string, number>): Sourced<CheckInInput>[] {
  return parseCsv(readRequired(archive, CHECK_INS_PATH)).map(({ line, values }) => {
    const quality = text(values.sleep_quality)?.toLowerCase() ?? null;
    const rated = quality !== null && Object.hasOwn(sleepScale, quality);
    const bodyFat = text(values.body_fat_pct);
    return {
      source: `${CHECK_INS_PATH}:${line}`,
      labels: [],
      warning: quality !== null && !rated ? `Sleep quality "${quality}" has no rating in the structure file, so it's kept in the notes.` : undefined,
      input: {
        date: values.date?.trim() ?? "",
        sleepHours: hours(values.sleep_duration),
        sleepQuality: rated ? sleepScale[quality]! : null,
        restingHr: number(values.resting_hr),
        leftKneePain: number(values.knee_pain_l),
        rightKneePain: number(values.knee_pain_r),
        energy: number(values.energy),
        motivation: number(values.motivation),
        lifeStress: number(values.life_stress),
        bodyWeight: number(values.body_weight_lbs),
        notes: clauses(
          text(values.notes),
          bodyFat && `Body fat: ${bodyFat}%`,
          quality !== null && !rated ? `Sleep quality: ${quality}` : null,
        ),
      },
    };
  });
}

/** Hours in an H:MM duration, or null if it's blank. Anything else is NaN, which the core rejects. */
function hours(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = /^(\d+):([0-5]\d)$/.exec(trimmed);
  return match ? Number(match[1]) + Number(match[2]) / 60 : Number.NaN;
}

/**
 * The Race Results in the race history: a markdown file with a `## <distance>`
 * section per distance and a `### <race> — <Mon D, YYYY>` heading per race,
 * followed by `- **<Field>**: <value>` bullets. Bullets without a field of
 * their own (except the narrative, which goes in the race's narrative
 * document) are kept in the notes.
 */
export function readRaceResults(archive: ArchiveSource): Sourced<RaceResultInput>[] {
  return raceEntries(archive).map((race) => toRaceResult(race.line, race.name, race.date, race.distance, race.fields));
}

/** A race's narrative document: its entry in the race history, as markdown. */
export type RaceNarrative = {
  /** Its vault path, the one its Race Result links to. */
  path: string;
  /** The entry's lines, from its heading to the next heading or `---` rule. */
  excerpt: Excerpt;
  /** The anchors a link to the race history could use for this entry, lowercased. */
  anchors: string[];
};

/** The narrative documents for the races in the race history. */
export function readRaceNarratives(archive: ArchiveSource): RaceNarrative[] {
  return raceEntries(archive).map((race) => ({
    path: raceNarrativePath(race.date, race.name),
    excerpt: { firstLine: race.line, lines: relevel(race.lines, 1) },
    anchors: [race.heading.toLowerCase(), githubAnchor(race.heading)],
  }));
}

type RaceEntry = {
  line: number;
  heading: string;
  name: string;
  date: string;
  distance: string;
  fields: [string, string][];
  lines: string[];
};

function raceEntries(archive: ArchiveSource): RaceEntry[] {
  const races: RaceEntry[] = [];
  let distance = "";
  let race: RaceEntry | null = null;
  for (const [index, row] of readRequired(archive, RACE_HISTORY_PATH).split(/\r?\n/).entries()) {
    const section = /^##\s+(?!#)(.+)$/.exec(row);
    const heading = /^###\s+((.+?)\s+[—–-]\s+(.+))$/.exec(row);
    const bullet = /^\s*[-*]\s+\*\*(.+?)\*\*:?\s*(.*)$/.exec(row);
    if (section || heading || /^#{1,3}\s/.test(row) || /^\s*---+\s*$/.test(row)) race = null;
    if (section) {
      distance = section[1]!.trim();
    } else if (heading) {
      race = {
        line: index + 1,
        heading: heading[1]!.trim(),
        name: heading[2]!.trim(),
        date: parseLongDate(heading[3]!.trim()),
        distance,
        fields: [],
        lines: [],
      };
      races.push(race);
    } else if (bullet && race) {
      race.fields.push([bullet[1]!.replace(/:$/, "").trim(), bullet[2]!.trim()]);
    }
    race?.lines.push(row);
  }
  for (const entry of races) {
    while (entry.lines.length > 0 && entry.lines.at(-1)!.trim() === "") entry.lines.pop();
  }
  return races;
}

/** The anchor GitHub gives a heading: lowercased, punctuation dropped, spaces as hyphens. */
function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");
}

function toRaceResult(line: number, name: string, date: string, distance: string, fields: [string, string][]): Sourced<RaceResultInput> {
  const field = (name: string) => fields.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  const mapped = ["conditions", "avg hr", "placement", "narrative"];
  const avgHr = /\d+/.exec(field("Avg HR") ?? "")?.[0];
  return {
    source: `${RACE_HISTORY_PATH}:${line}`,
    labels: [],
    input: {
      date,
      name,
      distance,
      officialTime: /\d+:\d{2}(?::\d{2})?/.exec(field("Result") ?? "")?.[0] ?? "",
      pace: /\d+:\d{2}\/mi/.exec(field("Distance / Pace") ?? "")?.[0] ?? null,
      conditions: field("Conditions"),
      avgHr: avgHr === undefined ? null : Number(avgHr),
      placement: field("Placement"),
      narrativePath: raceNarrativePath(date, name),
      notes: clauses(...fields.filter(([key]) => !mapped.includes(key.toLowerCase())).map(([key, value]) => `${key}: ${value}`)),
    },
  };
}

/** The vault path of a race's narrative document: Races/<YYYY-MM-DD>-<race>.md. */
export function raceNarrativePath(date: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Races/${date}-${slug}.md`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** YYYY-MM-DD from a date like "Apr 12, 2031" or "April 12, 2031". Anything else is returned as is, for the core to reject. */
function parseLongDate(value: string): string {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
  const month = match ? MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) : -1;
  if (!match || month < 0) return value;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

/** One pair from the shoe log's table. */
export type ShoeLogEntry = {
  source: string;
  id: string;
  model: string | null;
  retired: boolean;
  /** The log's Last Run date, if it gives one. */
  lastRun: string | null;
  notes: string | null;
};

/** The pairs in the shoe log, a markdown table with Shoe, Model, Status, Last Run and Notes columns. */
export function readShoeLog(archive: ArchiveSource): ShoeLogEntry[] {
  const rows = markdownTable(readRequired(archive, SHOE_LOG_PATH), "Shoe");
  return rows.map(({ line, values }) => ({
    source: `${SHOE_LOG_PATH}:${line}`,
    id: values.Shoe ?? "",
    model: text(values.Model),
    retired: /^retired/i.test(values.Status ?? ""),
    lastRun: /^\d{4}-\d{2}-\d{2}$/.test(values["Last Run"] ?? "") ? values["Last Run"]! : null,
    notes: text(values.Notes),
  }));
}

/**
 * The rows of the first markdown table whose header starts with `firstColumn`,
 * by column name.
 */
function markdownTable(markdown: string, firstColumn: string): { line: number; values: Record<string, string> }[] {
  const lines = markdown.split(/\r?\n/);
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const start = lines.findIndex((row) => row.trim().startsWith("|") && cells(row)[0] === firstColumn);
  if (start < 0) return [];
  const header = cells(lines[start]!);
  const rows: { line: number; values: Record<string, string> }[] = [];
  for (let i = start + 2; i < lines.length && lines[i]!.trim().startsWith("|"); i++) {
    const row = cells(lines[i]!);
    rows.push({ line: i + 1, values: Object.fromEntries(header.map((name, j) => [name, row[j] ?? ""])) });
  }
  return rows;
}

function labelAt(source: string, value: string | undefined): Sourced<unknown>["labels"] {
  const label = text(value);
  return label === null ? [] : [{ source, label }];
}

/** The clauses that are present, joined with "; ", or null if none are. */
function clauses(...parts: (string | null)[]): string | null {
  const present = parts.filter((part) => part);
  return present.length > 0 ? present.join("; ") : null;
}

/** The trimmed text, or null if it's blank. */
export function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The number, or null if it's blank. Anything else is NaN, which the core rejects. */
export function number(value: string | undefined): number | null {
  const trimmed = value?.trim();
  return trimmed ? Number(trimmed) : null;
}
