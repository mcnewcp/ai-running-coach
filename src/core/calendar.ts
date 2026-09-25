import { DomainError } from "./errors";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** A local calendar date in the athlete's timezone. */
export type LocalDate = {
  /** ISO 8601 calendar date, e.g. `2026-09-24`. */
  date: string;
  weekday: Weekday;
  /** The IANA timezone the date is local to. */
  timezone: string;
};

/**
 * Returns the athlete's timezone from the `ATHLETE_TIMEZONE` setting,
 * or fails if it's missing or not an IANA timezone.
 */
export function athleteTimezone(env: Pick<Env, "ATHLETE_TIMEZONE">): string {
  const timezone = env.ATHLETE_TIMEZONE?.trim();
  if (!timezone) {
    throw new DomainError("The ATHLETE_TIMEZONE setting is missing. Set it to an IANA timezone, e.g. America/New_York.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new DomainError(`The ATHLETE_TIMEZONE setting "${timezone}" is not an IANA timezone, e.g. America/New_York.`);
  }
  return timezone;
}

/** The local calendar date and weekday at `instant` in `timezone`. */
export function localDate(instant: Date, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday") as Weekday,
    timezone,
  };
}
