import { type LocalDay, localDay, parseTimezone } from "./calendar";
import { homeTimezone, type RunnerProfile, readRunnerProfile } from "./runner-profile";

// What a coaching session starts from: what day it is for the runner, and
// (get_coaching_context) everything the coach needs to know about where their
// training stands today.

/**
 * Today's local date for the runner at `now`: in `timezone` if given (the
 * runner's current IANA timezone, e.g. while travelling), else in the Home
 * Timezone from the Runner Profile (ADR 0004). Fails if neither is usable.
 */
export async function today(bucket: R2Bucket, now: Date, timezone?: string): Promise<LocalDay> {
  return todayFor(now, timezone, () => readRunnerProfile(bucket));
}

/**
 * Like `today`, with the Runner Profile supplied by `profile`, which is only
 * called when no timezone is given.
 */
async function todayFor(
  now: Date,
  timezone: string | undefined,
  profile: () => Promise<RunnerProfile | null>,
): Promise<LocalDay> {
  if (timezone !== undefined) return localDay(now, parseTimezone(timezone), "given");
  return localDay(now, homeTimezone(await profile()), "home");
}
