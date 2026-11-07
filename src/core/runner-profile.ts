import { type Document, findDocument } from "./documents";

/** Where the Runner Profile lives in the vault (README, "Documents"). */
export const RUNNER_PROFILE_PATH = "Runner Profile.md";

/** The Runner Profile document, with its frontmatter properties. */
export type RunnerProfile = Document & {
  /**
   * The flat `key: value` properties from the YAML frontmatter (Obsidian's
   * "Properties"), e.g. `timezone` for the Home Timezone. Values are strings.
   */
  properties: Record<string, string>;
};

/** Reads the Runner Profile, or returns null if the vault doesn't have one yet. */
export async function readRunnerProfile(bucket: R2Bucket): Promise<RunnerProfile | null> {
  const document = await findDocument(bucket, RUNNER_PROFILE_PATH);
  if (document === null) return null;
  return { ...document, properties: frontmatterProperties(document.content) };
}

/**
 * The flat scalar properties in a markdown document's YAML frontmatter: the
 * block between a `---` first line and the next `---` line. Quoted values are
 * unquoted. Lists, nested values and empty values are skipped: no property
 * needs them yet, and a full YAML parser isn't worth carrying for that.
 */
export function frontmatterProperties(markdown: string): Record<string, string> {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return {};
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
  if (end === -1) return {};

  const properties: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([^\s#:"'-][^:]*?):\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    if (quoted) {
      properties[key] = quoted[2]!;
      continue;
    }
    const value = raw.replace(/\s+#.*$/, "");
    if (value === "" || /^[[{|>&*!]/.test(value)) continue; // Not a plain scalar.
    properties[key] = value;
  }
  return properties;
}
