import { addDays, type LocalDay, localDay, parseTimezone } from "./calendar";
import { type Document, findDocument } from "./documents";
import { type WeekStanding, weekStanding } from "./mileage-cap";
import { findPlacement, findProgram, type Phase, type Program } from "./programs";
import { homeTimezone, type RunnerProfile, readRunnerProfile } from "./runner-profile";
import { listRuns, type Run } from "./runs";
import { listShoes, type Shoe } from "./shoes";

// What a coaching session starts from: what day it is for the runner, and
// everything the coach needs to know about where their training stands today.

/** How many days of Runs, ending today, count as recent. */
export const RECENT_RUN_DAYS = 14;

/** Everything a coaching session starts from, as of today. */
export type CoachingContext = {
  today: LocalDay;
  /** The Runner Profile, or null if the vault doesn't have one yet. */
  runnerProfile: RunnerProfile | null;
  /** The Program today falls in, with its Phases, or null if none covers today. */
  program: Program | null;
  /** The Phase today falls in, or null if none covers today. */
  phase: Phase | null;
  /**
   * The active Phase's Plan: the document at its `planPath`. Null if there's
   * no active Phase, it links no Plan, or the Plan isn't written yet.
   */
  plan: Document | null;
  /** This Monday–Sunday week's miles so far against its Mileage Cap. */
  week: WeekStanding;
  /** Runs in the RECENT_RUN_DAYS days ending today, newest first. */
  recentRuns: Run[];
  /** Active Shoes with their mileage. */
  shoes: Shoe[];
};

/**
 * Today's local date for the runner at `now`: in `timezone` if given (the
 * runner's current IANA timezone, e.g. while travelling), else in the Home
 * Timezone from the Runner Profile (ADR 0004). Fails if neither is usable.
 */
export async function today(bucket: R2Bucket, now: Date, timezone?: string): Promise<LocalDay> {
  return todayWith(now, timezone, () => readRunnerProfile(bucket));
}

/**
 * Everything a coaching session starts from, as of `now`. Today is worked out
 * as `today` does. Missing pieces (no Plan, no Runs, no Program covering
 * today) come back empty rather than failing.
 */
export async function getCoachingContext(
  store: { db: D1Database; bucket: R2Bucket },
  now: Date,
  timezone?: string,
): Promise<CoachingContext> {
  const { db, bucket } = store;
  const runnerProfile = await readRunnerProfile(bucket);
  const day = await todayWith(now, timezone, async () => runnerProfile);

  const placement = await findPlacement(db, day.date);
  const program = placement && (await findProgram(db, placement.program.name));
  const phase = placement?.phase ?? null;
  const plan = phase?.planPath ? await findDocument(bucket, phase.planPath) : null;

  return {
    today: day,
    runnerProfile,
    program,
    phase,
    plan,
    week: await weekStanding(db, day.date),
    recentRuns: await listRuns(db, { from: addDays(day.date, 1 - RECENT_RUN_DAYS), to: day.date }),
    shoes: await listShoes(db),
  };
}

/** Like `today`, reading the Runner Profile with `profile` only if no timezone is given. */
async function todayWith(
  now: Date,
  timezone: string | undefined,
  profile: () => Promise<RunnerProfile | null>,
): Promise<LocalDay> {
  if (timezone !== undefined) return localDay(now, parseTimezone(timezone), "given");
  return localDay(now, homeTimezone(await profile()), "home");
}
