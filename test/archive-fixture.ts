import type { ArchiveSource } from "../src/import";

// The synthetic archive in test/fixtures/archive: the private archive repo's
// shape, with no real Athlete Record data.

const fixtureFiles = import.meta.glob("./fixtures/archive/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ROOT = "./fixtures/archive/";

/** The synthetic archive, with `changes` applied: a file's new text, or null to leave it out. */
export function archiveFixture(changes: Record<string, string | null> = {}): ArchiveSource {
  const files = new Map(Object.entries(fixtureFiles).map(([key, text]) => [key.slice(ROOT.length), text]));
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) files.delete(path);
    else files.set(path, text);
  }
  return {
    read: (path) => files.get(path) ?? null,
    list: (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)).sort(),
  };
}

/** The synthetic archive as it is. */
export const fixture = archiveFixture();
