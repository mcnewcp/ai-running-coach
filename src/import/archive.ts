// Where the import reads the private archive from. The command reads a
// checkout on disk; tests read a synthetic fixture. Paths are relative to the
// archive's root and `/`-separated, e.g. "data/runs.csv". The reviewed
// extraction files are under "extraction/", wherever that folder really is.

export interface ArchiveSource {
  /** The file's text, or null if the archive has no such file. */
  read(path: string): string | null;
}

/** The file's text. Fails naming the file if the archive doesn't have it. */
export function readRequired(archive: ArchiveSource, path: string): string {
  const text = archive.read(path);
  if (text === null) throw new Error(`The archive has no ${path}.`);
  return text;
}
