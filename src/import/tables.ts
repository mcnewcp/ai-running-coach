// Whole-database operations the import needs: emptying D1, and dumping it as
// SQL to copy it to another D1 (the remote one). They name no tables, so they
// keep up with the schema on their own.

/** The Athlete Record's tables, parents before the tables that reference them. */
async function recordTables(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' " +
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    )
    .all<{ name: string }>();
  const parents = new Map<string, string[]>();
  for (const { name } of results) {
    const { results: keys } = await db.prepare(`PRAGMA foreign_key_list("${name}")`).all<{ table: string }>();
    parents.set(name, keys.map((key) => key.table).filter((table) => table !== name));
  }
  const ordered: string[] = [];
  const visit = (table: string) => {
    if (ordered.includes(table)) return;
    for (const parent of parents.get(table) ?? []) visit(parent);
    ordered.push(table);
  };
  for (const { name } of results) visit(name);
  return ordered;
}

/** Empties every table, keeping the schema. */
export async function wipe(db: D1Database): Promise<void> {
  const tables = await recordTables(db);
  if (tables.length === 0) return;
  await db.batch(tables.reverse().map((table) => db.prepare(`DELETE FROM "${table}"`)));
}

/**
 * SQL statements that make another D1 with the same schema identical to this
 * one: they empty every table, then insert every row, ids included. Run them
 * in order.
 */
export async function dumpStatements(db: D1Database): Promise<string[]> {
  const tables = await recordTables(db);
  const statements = [...tables].reverse().map((table) => `DELETE FROM "${table}"`);
  for (const table of tables) {
    const { results } = await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all<Record<string, unknown>>();
    for (const row of results) {
      const columns = Object.keys(row);
      statements.push(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((c) => literal(row[c])).join(", ")})`,
      );
    }
  }
  return statements;
}

/** One SELECT returning each table's row count, as a column named after the table. */
export async function rowCountsQuery(db: D1Database): Promise<string> {
  const tables = await recordTables(db);
  return `SELECT ${tables.map((table) => `(SELECT COUNT(*) FROM "${table}") AS "${table}"`).join(", ")}`;
}

/** A value as an SQL literal. */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Can't dump the number ${value}.`);
    return String(value);
  }
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`Can't dump a ${typeof value} value.`);
}
