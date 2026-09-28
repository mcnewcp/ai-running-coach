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

/**
 * The Home Timezone until the Runner Profile holds it (#8, #9). Temporary: it
 * goes away once `today` reads the Home Timezone from the profile.
 */
export const TEMPORARY_HOME_TIMEZONE = "America/Chicago";

/** Whether the timezone was the Home Timezone or given by the caller. */
export type TimezoneSource = "home" | "given";

/** A local calendar date: what day it is for the runner. */
export type LocalDay = {
  /** ISO 8601 calendar date, e.g. `2026-09-24`. */
  date: string;
  weekday: Weekday;
  /** The IANA timezone the date is local to. */
  timezone: string;
  timezoneSource: TimezoneSource;
};

/**
 * Today's local date for the runner: in `timezone` if given (the runner's
 * current timezone, e.g. while travelling), else in the Home Timezone.
 */
export function today(now: Date, timezone?: string): LocalDay {
  if (timezone === undefined) {
    return localDay(now, TEMPORARY_HOME_TIMEZONE, "home");
  }
  return localDay(now, parseTimezone(timezone), "given");
}

/**
 * Returns the canonical IANA name for `value`, or fails. Abbreviations like
 * `CST` are rejected: they're ambiguous, and the runtime maps some of them to
 * zones without DST (`EST` becomes America/Panama).
 */
function parseTimezone(value: string): string {
  const invalid = new DomainError(
    `"${value}" is not an IANA timezone. Use an Area/Location name, e.g. America/Chicago or Europe/London.`,
  );
  if (value !== "UTC" && !value.includes("/")) throw invalid;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw invalid;
  }
}

function localDay(instant: Date, timezone: string, timezoneSource: TimezoneSource): LocalDay {
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
    timezoneSource,
  };
}
