import { addDays, parseDate, type Week, weekOf } from "./calendar";
import { DomainError } from "./errors";

// The Mileage Cap: the guideline ceiling for a week's mileage, the previous
// Monday–Sunday week's actual miles × 1.10. It's computed and reported, never
// enforced: the runner decides (CONTEXT.md).

const CAP_FACTOR = 1.1;

/** Where a Monday–Sunday week stands against its Mileage Cap. */
export type WeekStanding = Week & {
  /** Miles recorded in the week so far. */
  miles: number;
  /** Miles recorded in the week before it, which sets the cap. */
  previousWeekMiles: number;
  /** The week's Mileage Cap: previousWeekMiles × 1.10. */
  cap: number;
};

/** A proposed week's mileage against its Mileage Cap. */
export type MileageCapCheck = {
  week: WeekStanding;
  cap: number;
  proposed: number;
  /** Whether the proposal is over the cap. Exactly at the cap is within it. */
  exceeds: boolean;
  /** proposed − cap: positive when over, negative when under. */
  delta: number;
};

/**
 * Where the Monday–Sunday week containing `date` stands against its Mileage
 * Cap. For "this week", pass today's local date (calendar `today`).
 */
export async function weekStanding(db: D1Database, date: string): Promise<WeekStanding> {
  const week = weekOf(parseDate(date, "week"));
  const previousStart = addDays(week.start, -7);
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= ?2 THEN distance_miles END), 0) AS miles,
         COALESCE(SUM(CASE WHEN date < ?2 THEN distance_miles END), 0) AS previous
       FROM runs WHERE date >= ?1 AND date <= ?3`,
    )
    .bind(previousStart, week.start, week.end)
    .first<{ miles: number; previous: number }>();
  const previousWeekMiles = roundMiles(row!.previous);
  return {
    ...week,
    miles: roundMiles(row!.miles),
    previousWeekMiles,
    cap: roundMiles(previousWeekMiles * CAP_FACTOR),
  };
}

/**
 * Whether `proposedMiles` for the week containing `date` exceeds its Mileage
 * Cap. It only answers: the warning and the runner's decision happen in
 * conversation.
 */
export async function checkMileageCap(db: D1Database, proposedMiles: number, date: string): Promise<MileageCapCheck> {
  if (!(proposedMiles >= 0)) {
    throw new DomainError(`proposed_week_miles can't be negative, got ${proposedMiles}.`);
  }
  const week = await weekStanding(db, date);
  const proposed = roundMiles(proposedMiles);
  return { week, cap: week.cap, proposed, exceeds: proposed > week.cap, delta: roundMiles(proposed - week.cap) };
}

/** Miles to the hundredth, which also clears floating-point noise (3.1 + 4.2). */
export function roundMiles(miles: number): number {
  return Math.round(miles * 100) / 100 + 0;
}
