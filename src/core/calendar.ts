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

/** How to write a timezone, for error messages. */
export const TIMEZONE_HINT = "an Area/Location name, e.g. America/Chicago or Europe/London";

/**
 * The canonical IANA name for `value`, or null if it isn't one. Abbreviations
 * like `CST` are rejected: they're ambiguous, and the runtime maps some of
 * them to zones without DST (`EST` becomes America/Panama).
 */
export function ianaTimezone(value: string): string | null {
  if (value !== "UTC" && !value.includes("/")) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The canonical IANA name for a timezone the caller gave, or fails. */
export function parseTimezone(value: string): string {
  const timezone = ianaTimezone(value);
  if (timezone === null) throw new DomainError(`"${value}" is not an IANA timezone. Use ${TIMEZONE_HINT}.`);
  return timezone;
}

/**
 * The local calendar date and weekday at `instant` in `timezone`, a canonical
 * IANA name (see `ianaTimezone`).
 */
export function localDay(instant: Date, timezone: string, timezoneSource: TimezoneSource): LocalDay {
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

/**
 * Returns `value` if it's a real ISO 8601 calendar date (`YYYY-MM-DD`), or
 * fails naming the `field` it came from.
 */
export function parseDate(value: string, field = "date"): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new DomainError(`${field} "${value}" is not a calendar date. Use YYYY-MM-DD, e.g. 2026-09-24.`);
  }
  return value;
}

/** The calendar date `days` days after `date` (before it, if negative). */
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return isoDate(result);
}

/** A Monday–Sunday week, both ends included. */
export type Week = { start: string; end: string };

/** The Monday–Sunday week containing the calendar date `date`. */
export function weekOf(date: string): Week {
  const daysSinceMonday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(date, -daysSinceMonday);
  return { start, end: addDays(start, 6) };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
