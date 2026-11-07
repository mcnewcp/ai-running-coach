import { DomainError } from "./errors";

// Read-only analysis queries over the structured Athlete Record. D1 has no
// read-only mode, and it runs every statement in a string it's given, so a
// query is guarded in layers:
//
// 1. `checkReadOnly` scans it as SQLite does (strings, quoted names and
//    comments) and rejects anything but one SELECT (or WITH … SELECT)
//    statement: more than one statement, unbalanced parentheses, or any
//    keyword that writes or changes the connection (INSERT, PRAGMA, ATTACH …).
// 2. The checked query runs as a subquery, `SELECT * FROM (<query>)`, where
//    SQLite's grammar only admits a SELECT: a write, a PRAGMA or a second
//    statement there is a syntax error, so nothing runs.
// 3. D1 itself refuses ATTACH and most PRAGMAs (SQLITE_AUTH).

/** The most rows a query returns. */
export const MAX_QUERY_ROWS = 1000;

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  /** Whether rows beyond MAX_QUERY_ROWS were left out. */
  truncated: boolean;
};

/**
 * Runs a read-only SELECT (or WITH … SELECT) statement against the structured
 * Athlete Record and returns at most MAX_QUERY_ROWS rows. Fails, running
 * nothing, if `sql` is anything else.
 */
export async function runQuery(db: D1Database, sql: string): Promise<QueryResult> {
  const checked = checkReadOnly(sql);
  const prefix = "SELECT * FROM (\n";
  const wrapped = `${prefix}${checked}\n) LIMIT ${MAX_QUERY_ROWS + 1}`;
  let raw: unknown[][];
  try {
    raw = await db.prepare(wrapped).raw({ columnNames: true });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
      .replace(/^D1_ERROR:\s*/, "")
      .replace(/:\s*SQLITE_\w+$/, "")
      .replace(/at offset (\d+)/, (_, offset: string) => `at offset ${Math.max(0, Number(offset) - prefix.length)}`);
    throw new DomainError(`The query failed: ${message}`);
  }
  const [columns = [], ...rows] = raw;
  return {
    columns: columns as string[],
    rows: rows.slice(0, MAX_QUERY_ROWS),
    truncated: rows.length > MAX_QUERY_ROWS,
  };
}

/**
 * Keywords that write, change the schema or change the connection. None can
 * appear in a read-only SELECT. REPLACE is also a string function, so it only
 * counts when it isn't called like one.
 */
const FORBIDDEN = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "UPSERT",
  "CREATE",
  "DROP",
  "ALTER",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "TRANSACTION",
]);

const HINT = "Write one read-only SELECT statement (WITH … SELECT is fine).";

/**
 * Returns `sql` with its comments blanked out and any trailing semicolon
 * removed, if it's a single read-only SELECT (or WITH … SELECT) statement.
 * Otherwise fails, saying why.
 */
export function checkReadOnly(sql: string): string {
  const { text, words, statementEnds, parenthesesBalanced } = scan(sql);
  let clean = text.trimEnd();
  if (statementEnds.length > 0 && statementEnds.at(-1) === clean.length - 1) {
    statementEnds.pop();
    clean = clean.slice(0, -1).trimEnd();
  }
  if (clean.trim() === "") throw new DomainError(`The query is empty. ${HINT}`);
  if (statementEnds.length > 0) {
    throw new DomainError(`The query must be a single statement, but it has more than one statement. ${HINT}`);
  }
  if (!parenthesesBalanced) throw new DomainError(`The query has unbalanced parentheses. ${HINT}`);
  for (const word of words) {
    const upper = word.text.toUpperCase();
    if (!FORBIDDEN.has(upper)) continue;
    if (upper === "REPLACE" && clean.slice(word.end).trimStart().startsWith("(")) continue;
    throw new DomainError(`The query is read-only: ${upper} isn't allowed. ${HINT}`);
  }
  const first = words[0]?.text.toUpperCase();
  if (first !== "SELECT" && first !== "WITH" && first !== "VALUES") {
    throw new DomainError(`The query is read-only, so it must start with SELECT or WITH. ${HINT}`);
  }
  return clean;
}

type Scan = {
  /** `sql` with each comment replaced by a space. */
  text: string;
  /** Bare words (keywords and unquoted names) outside strings, quoted names and comments, with their end in `text`. */
  words: { text: string; end: number }[];
  /** Where each `;` outside strings, quoted names and comments is in `text`. */
  statementEnds: number[];
  /** Whether parentheses outside strings, quoted names and comments nest properly. */
  parenthesesBalanced: boolean;
};

/**
 * Scans `sql` the way SQLite tokenizes it: '…' strings and "…" and `…`
 * quoted names (each doubling its quote to escape it), […] quoted names,
 * -- comments to the end of the line and /* … *\/ comments (to the end, if
 * unclosed). Fails on an unterminated string or quoted name.
 */
function scan(sql: string): Scan {
  let text = "";
  const words: Scan["words"] = [];
  const statementEnds: number[] = [];
  let depth = 0;
  let balanced = true;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      text += " ";
    } else if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      text += " ";
    } else if (char === "'" || char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      let j = i + 1;
      for (;;) {
        const end = sql.indexOf(close, j);
        if (end === -1) {
          const what = char === "'" ? "string" : "quoted name";
          throw new DomainError(`The query has an unterminated ${what}, starting at offset ${i}. ${HINT}`);
        }
        if (close !== "]" && sql[end + 1] === close) {
          j = end + 2;
          continue;
        }
        j = end + 1;
        break;
      }
      text += sql.slice(i, j);
      i = j;
    } else if (/[A-Za-z_\u0080-￿]/.test(char)) {
      const match = /^[A-Za-z0-9_$\u0080-￿]+/.exec(sql.slice(i))!;
      text += match[0];
      words.push({ text: match[0], end: text.length });
      i += match[0].length;
    } else {
      if (char === ";") statementEnds.push(text.length);
      if (char === "(") depth++;
      if (char === ")" && --depth < 0) balanced = false;
      text += char;
      i++;
    }
  }
  return { text, words, statementEnds, parenthesesBalanced: balanced && depth === 0 };
}
