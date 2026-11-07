import { DomainError } from "./errors";
import { placeDate, type Placement } from "./programs";

// Helpers shared by the dated records (Strength Sessions, Daily Check-ins,
// Body-comp Scans, Race Results). Each record belongs to the Phase its date
// falls in (ADR 0003): it's never stored, only derived when the record is
// written or read.

/** A record as a write returns it: the record, plus the Program and Phase its date falls in. */
export type Attributed = Pick<Placement, "program" | "phase">;

/**
 * The Program and Phase `date` falls in. Fails with a clear message if the
 * date isn't a calendar date or no Phase covers it.
 */
export async function attribute(db: D1Database, date: string): Promise<Attributed> {
  const { program, phase } = await placeDate(db, date);
  return { program, phase };
}

type NumberRule = { min?: number; max?: number; integer?: boolean };

/** A 0-10 rating: pain, sleep quality, energy, motivation, life stress. */
export const RATING: NumberRule = { min: 0, max: 10 };

/** A heart rate in bpm: average or resting. */
export const HEART_RATE: NumberRule = { min: 1, max: 250, integer: true };

/**
 * Returns `value` (or null if it's missing) if it's a finite number within
 * the rule, or fails naming the `field`.
 */
export function checkNumber(value: number | null | undefined, field: string, rule: NumberRule = {}): number | null {
  if (value === null || value === undefined) return null;
  const { min = 0, max, integer = false } = rule;
  const problem = !Number.isFinite(value)
    ? "a number"
    : integer && !Number.isInteger(value)
      ? "a whole number"
      : undefined;
  if (problem) throw new DomainError(`${field} must be ${problem}, not ${value}.`);
  if (value < min || (max !== undefined && value > max)) {
    const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
    throw new DomainError(`${field} must be ${range}, not ${value}.`);
  }
  return value;
}

/** Returns the trimmed `value`, or null if it's missing or blank. */
export function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Returns the trimmed `value`, or fails naming the `field` if it's missing or blank. */
export function requiredText(value: string | null | undefined, field: string): string {
  const text = optionalText(value);
  if (text === null) throw new DomainError(`${field} is required.`);
  return text;
}

/**
 * Merges a correction into a record: fields in `changes` that are undefined
 * keep their current value; null clears a field.
 */
export function merge<T extends object>(current: T, changes: Partial<{ [K in keyof T]: T[K] | null }>): T {
  const merged = { ...current };
  for (const key of Object.keys(changes) as (keyof T)[]) {
    const value = changes[key];
    if (value !== undefined) merged[key] = value as T[keyof T];
  }
  return merged;
}

/** Fails with a "not found" message for a record `noun` with `id`. */
export function notFound(noun: string, id: number | string): never {
  throw new DomainError(`There's no ${noun} ${id}.`);
}
