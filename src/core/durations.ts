import { DomainError } from "./errors";

// Durations and times, written h:mm:ss or m:ss: a Run's moving time and pace,
// and a Race Result's official time. Stored as whole seconds.

/**
 * Seconds in a duration written `h:mm:ss` or `m:ss` (minutes may run past
 * 59 when there are no hours, e.g. 65:07). A fraction of a second rounds up
 * to the next whole second, as official road times do. Fails naming the
 * `field` if it isn't a duration, or is zero.
 */
export function parseDuration(value: string, field: string): number {
  const usage = "Use h:mm:ss or m:ss, e.g. 1:05:30 or 27:45.";
  const match = /^(?:(\d+):(\d{1,2})|(\d+)):(\d{2})(?:\.(\d+))?$/.exec(value.trim());
  const [, hours, minutesAfterHours, minutesOnly, seconds, fraction] = match ?? [];
  if (!match || Number(seconds) > 59 || Number(minutesAfterHours) > 59) {
    throw new DomainError(`${field} "${value}" is not a time. ${usage}`);
  }
  const minutes = hours === undefined ? Number(minutesOnly) : Number(hours) * 60 + Number(minutesAfterHours);
  const total = minutes * 60 + Number(seconds) + (fraction && Number(fraction) > 0 ? 1 : 0);
  if (total === 0) throw new DomainError(`${field} must be more than zero. ${usage}`);
  return total;
}

/** `h:mm:ss`, or `m:ss` under an hour, to the nearest second. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
