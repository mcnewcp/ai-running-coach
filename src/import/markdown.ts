// Markdown handling the document import needs: finding a section by its
// heading path, moving headings to another level, and rewriting links.
// Anything inside a fenced code block is left alone.

/** A run of a file's lines, with the line number of the first. */
export type Excerpt = { firstLine: number; lines: string[] };

type Heading = { index: number; level: number; text: string };

/** For each line, whether it's part of a fenced code block, fences included. */
function inFence(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && fence === null) fence = marker[0]!.repeat(marker.length);
    else if (marker && fence !== null && marker.startsWith(fence)) fence = null;
    else return fence !== null;
    return true;
  });
}

/** The ATX headings in `lines`, skipping fenced code blocks. */
function headings(lines: string[]): Heading[] {
  const fenced = inFence(lines);
  const found: Heading[] = [];
  lines.forEach((line, index) => {
    if (fenced[index]) return;
    const match = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (match) found.push({ index, level: match[1]!.length, text: match[2]!.trim() });
  });
  return found;
}

/**
 * The section of `markdown` under the heading path `path`: each heading
 * nested under the one before, matched ignoring case. It runs from its
 * heading to the next heading at the same level or above. Without
 * `withHeading`, it leaves out its own heading. Null if there's no such
 * section.
 */
export function findSection(markdown: string, path: string[], withHeading = true): Excerpt | null {
  const lines = markdown.split(/\r?\n/);
  const all = headings(lines);
  // The section found so far: its heading, and where it ends.
  let within: { heading: Heading; end: number } | undefined;
  for (const name of path) {
    const parent = within;
    const match = all.find(
      (h) =>
        (parent === undefined ||
          (h.index > parent.heading.index && h.index < parent.end && h.level > parent.heading.level)) &&
        same(h.text, name),
    );
    if (!match) return null;
    const end = all.find((h) => h.index > match.index && h.level <= match.level)?.index ?? lines.length;
    within = { heading: match, end };
  }
  if (within === undefined) return wholeFile(markdown);
  const { heading, end } = within;
  return excerpt(lines, withHeading ? heading.index : heading.index + 1, end);
}

/** The whole of `markdown` as an excerpt, without blank lines at either end. */
export function wholeFile(markdown: string): Excerpt {
  const lines = markdown.split(/\r?\n/);
  return excerpt(lines, 0, lines.length);
}

/** lines[from, to) without blank lines at either end. */
function excerpt(lines: string[], from: number, to: number): Excerpt {
  while (from < to && lines[from]!.trim() === "") from++;
  while (to > from && lines[to - 1]!.trim() === "") to--;
  return { firstLine: from + 1, lines: lines.slice(from, to) };
}

/** `lines` with the headings moved so the shallowest is at `level`. Levels stay within 1-6. */
export function relevel(lines: string[], level: number): string[] {
  const found = headings(lines);
  if (found.length === 0) return lines;
  const shift = level - Math.min(...found.map((h) => h.level));
  const at = new Map(found.map((h) => [h.index, h]));
  return lines.map((line, index) => {
    const heading = at.get(index);
    if (!heading) return line;
    const newLevel = Math.min(6, Math.max(1, heading.level + shift));
    return line.replace(/^(\s{0,3})#{1,6}/, `$1${"#".repeat(newLevel)}`);
  });
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A markdown link: `[text](target)`, or an image `![text](target)`. */
export type Link = {
  /** The whole link as written. */
  raw: string;
  text: string;
  /** The destination as written, without angle brackets or title. */
  target: string;
  /** The title as written, with its leading space and quotes, or "". */
  title: string;
  /** Index into the lines given to `replaceLinks`. */
  line: number;
};

const LINK = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^\s()]+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

/**
 * `lines` with each inline link replaced by what `replace` returns for it
 * (undefined keeps it). Links in fenced code blocks and code spans are left
 * alone.
 */
export function replaceLinks(lines: string[], replace: (link: Link) => string | undefined): string[] {
  const fenced = inFence(lines);
  return lines.map((line, index) => {
    if (fenced[index]) return line;
    // Split out code spans, and only look for links outside them.
    return line
      .split(/(`+[^`]*`+)/)
      .map((piece, i) =>
        i % 2 === 1
          ? piece
          : piece.replace(LINK, (raw, _bang: string, text: string, target: string, title: string | undefined) => {
              const bare = target.startsWith("<") ? target.slice(1, -1) : target;
              return replace({ raw, text, target: bare, title: title ?? "", line: index }) ?? raw;
            }),
      )
      .join("");
  });
}
