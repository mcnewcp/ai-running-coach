import { ianaTimezone } from "../core/calendar";
import { type ArchiveSource, readRequired } from "./archive";

// Which of the archive's text belongs in the runner's vault, and where. What
// is athlete-specific takes judgement about one runner, so it's decided once
// and reviewed, like the other extraction files, and kept in the private
// archive as extraction/vault.json. Nothing specific to one runner lives in
// this repo.

export const VAULT_CONFIG_PATH = "extraction/vault.json";

/**
 * Some archive text to copy: a whole file, or one section of it. A section is
 * named by its heading path, each heading nested under the one before, e.g.
 * ["Reminders", "What Works"].
 */
export type Part = {
  /** The archive file, e.g. "CLAUDE.md". */
  from: string;
  /** The section's heading path. Leave it out for the whole file. */
  section?: string[];
  /** Whether to keep the section's own heading (default true), or only what's under it. */
  heading?: boolean;
};

/** Where a link to an archive path goes: a vault path, a web URL, or a note in place of the link. */
export type LinkTarget = string | { note: string };

export type VaultConfig = {
  runnerProfile: {
    /** The Home Timezone, an IANA name. It becomes the Runner Profile's `timezone` property. */
    timezone: string;
    /** The athlete-specific text the Runner Profile is made of, in order. */
    parts: Part[];
  };
  /** Athlete-specific resources, copied whole to `to` (default Resources/<file name>). */
  resources: { from: string; to?: string }[];
  /** Where links to these archive paths go, for archive files the import doesn't carry into the vault. */
  links: Record<string, LinkTarget>;
};

export function readVaultConfig(archive: ArchiveSource): VaultConfig {
  const parsed = JSON.parse(readRequired(archive, VAULT_CONFIG_PATH)) as Partial<VaultConfig>;
  const profile = parsed.runnerProfile;
  if (!profile || !Array.isArray(profile.parts)) {
    throw new Error(`${VAULT_CONFIG_PATH} needs a "runnerProfile" with a "parts" list.`);
  }
  if (typeof profile.timezone !== "string" || ianaTimezone(profile.timezone) === null) {
    throw new Error(
      `${VAULT_CONFIG_PATH} needs "runnerProfile.timezone", the runner's Home Timezone as an IANA name (e.g. "America/Chicago").`,
    );
  }
  return {
    runnerProfile: { timezone: ianaTimezone(profile.timezone)!, parts: profile.parts },
    resources: parsed.resources ?? [],
    links: parsed.links ?? {},
  };
}
