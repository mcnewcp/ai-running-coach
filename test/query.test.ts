import { beforeEach, describe, expect, it } from "vitest";
import { offSeason } from "./fixtures";
import { callTool, callToolExpectingError, connect, resetDatabase } from "./mcp";

// All Programs, Runs and Shoes here are synthetic.

beforeEach(resetDatabase);

type Client = Awaited<ReturnType<typeof connect>>;

/** A season with three Runs in two Shoes. */
async function season(): Promise<Client> {
  const client = await connect();
  await callTool(client, "upsert_program", offSeason);
  await callTool(client, "add_shoe", { id: "trainer-blue" });
  await callTool(client, "add_shoe", { id: "racer-red" });
  await callTool(client, "log_run", { date: "2026-11-03", distance: 3, duration: "30:00", shoe: "trainer-blue", avgHr: 140 });
  await callTool(client, "log_run", { date: "2026-11-05", distance: 4, duration: "38:00", shoe: "racer-red", avgHr: 150 });
  await callTool(client, "log_run", { date: "2026-11-17", distance: 5, duration: "52:30", shoe: "trainer-blue", avgHr: 142 });
  return client;
}

/** How many Runs there are, through the query tool itself. */
async function runCount(client: Client): Promise<number> {
  const output = await callTool(client, "query", { sql: "SELECT COUNT(*) AS n FROM runs" });
  return (output.rows as number[][])[0]![0]!;
}

describe("query", () => {
  it("runs a SELECT and returns its columns and rows", async () => {
    const client = await season();
    const output = await callTool(client, "query", {
      sql: "SELECT shoe_id, SUM(distance_miles) AS miles, COUNT(*) AS runs FROM runs GROUP BY shoe_id ORDER BY shoe_id",
    });
    expect(output).toEqual({
      columns: ["shoe_id", "miles", "runs"],
      rows: [
        ["racer-red", 4, 1],
        ["trainer-blue", 8, 2],
      ],
      truncated: false,
    });
  });

  it("runs a read-only WITH query, e.g. joining Runs to the Phase their date falls in", async () => {
    const client = await season();
    const output = await callTool(client, "query", {
      sql: `WITH by_phase AS (
              SELECT ph.name AS phase, r.distance_miles AS miles
              FROM runs r JOIN phases ph ON r.date BETWEEN ph.start_date AND ph.end_date
            )
            SELECT phase, SUM(miles) AS miles FROM by_phase GROUP BY phase ORDER BY phase;`,
    });
    expect(output.rows).toEqual([
      ["Base", 5],
      ["Recovery", 7],
    ]);
  });

  it("keeps semicolons and keywords inside strings, quoted names and comments harmless", async () => {
    const client = await season();
    const output = await callTool(client, "query", {
      sql: `-- a note; DELETE FROM runs
            SELECT 'drop; delete' AS "update", /* insert; */ COUNT(*) AS [n] FROM runs`,
    });
    expect(output.rows).toEqual([["drop; delete", 3]]);
  });

  it("returns at most 1000 rows, and says when it cut the rest", async () => {
    const client = await season();
    const output = await callTool(client, "query", {
      sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500) SELECT i FROM n",
    });
    expect((output.rows as unknown[]).length).toBe(1000);
    expect(output.truncated).toBe(true);
  });

  it("accepts names that happen to be keywords, e.g. release, analyze or replace", async () => {
    const client = await season();
    const output = await callTool(client, "query", {
      sql: `WITH release AS (SELECT date AS analyze, distance_miles AS replace, notes AS pragma FROM runs)
            SELECT COUNT(*) AS vacuum, SUM(replace) AS savepoint, REPLACE('a-b', '-', '') AS begin
            FROM release WHERE analyze >= '2026-11-04'`,
    });
    expect(output).toEqual({ columns: ["vacuum", "savepoint", "begin"], rows: [[2, 9, "ab"]], truncated: false });
  });

  it("can read the schema", async () => {
    const client = await connect();
    const output = await callTool(client, "query", { sql: "SELECT name FROM pragma_table_info('runs') ORDER BY cid" });
    expect((output.rows as string[][]).map(([name]) => name)).toContain("distance_miles");
  });

  describe("rejects anything that isn't a single read-only SELECT, and changes nothing", () => {
    it.each([
      ["an INSERT", "INSERT INTO shoes (id, status, warn_at_miles) VALUES ('x', 'active', 300)"],
      ["an UPDATE", "UPDATE runs SET distance_miles = 100"],
      ["a DELETE", "DELETE FROM runs"],
      ["a REPLACE", "REPLACE INTO shoes (id, status, warn_at_miles) VALUES ('x', 'active', 300)"],
      ["a DROP", "DROP TABLE runs"],
      ["a CREATE", "CREATE TABLE notes (x)"],
      ["an ALTER", "ALTER TABLE runs ADD COLUMN x"],
      ["a write hidden behind a CTE", "WITH doomed AS (SELECT id FROM runs) DELETE FROM runs WHERE id IN doomed"],
      ["an UPDATE behind a CTE", "WITH x AS (SELECT 1) UPDATE runs SET notes = 'x'"],
      ["a write behind a CTE named like a keyword", "WITH release AS (SELECT 1) DELETE FROM runs"],
      [
        "an INSERT behind several CTEs",
        "WITH a AS (SELECT 1), b(x) AS (SELECT 2) INSERT INTO shoes (id, status, warn_at_miles) SELECT 'x', 'active', 300",
      ],
      ["a REPLACE behind a CTE", "WITH a AS (SELECT 1) REPLACE INTO shoes (id, status, warn_at_miles) VALUES ('x', 'active', 300)"],
      ["a write behind a recursive CTE", "WITH RECURSIVE a(x) AS (SELECT 1) UPDATE runs SET notes = 'x'"],
      ["a write behind a materialized CTE", "WITH a AS NOT MATERIALIZED (SELECT 1) DELETE FROM runs"],
      ["a write behind a CTE, after a comment", "WITH a AS (SELECT 1) /* SELECT */ DELETE FROM runs"],
      ["a PRAGMA", "PRAGMA foreign_keys = OFF"],
      ["a reading PRAGMA statement", "PRAGMA table_info(runs)"],
      ["an ATTACH", "ATTACH DATABASE ':memory:' AS other"],
      ["a DETACH", "DETACH DATABASE other"],
      ["a VACUUM", "VACUUM"],
      ["a transaction", "BEGIN TRANSACTION"],
      ["multiple statements", "SELECT 1; DELETE FROM runs"],
      ["multiple SELECTs", "SELECT 1; SELECT 2"],
      ["a write after a comment", "SELECT 1 /* ok */; DELETE FROM runs"],
      ["a breakout from a subquery", "SELECT 1) ; DELETE FROM runs; SELECT * FROM (SELECT 1"],
      ["a lowercase write", "delete from runs"],
      ["an unterminated string", "SELECT 'oops FROM runs"],
      ["an unterminated quoted name", 'SELECT "oops FROM runs'],
      ["an empty query", "   "],
    ])("%s", async (_, sql) => {
      const client = await season();
      const error = await callToolExpectingError(client, "query", { sql });
      expect(error).toMatch(/read-only|single|empty|unterminated|unbalanced/i);
      expect(await runCount(client)).toBe(3);
      expect(await callTool(client, "list_shoes")).toMatchObject({ shoes: [{ id: "racer-red" }, { id: "trainer-blue" }] });
    });

    it("says why", async () => {
      const client = await connect();
      expect(await callToolExpectingError(client, "query", { sql: "WITH x AS (SELECT 1) DELETE FROM runs" })).toMatch(
        /DELETE/,
      );
      expect(await callToolExpectingError(client, "query", { sql: "SELECT 1; SELECT 2" })).toMatch(/one statement/);
    });
  });

  it("reports a broken query clearly", async () => {
    const error = await callToolExpectingError(await connect(), "query", { sql: "SELECT nope FROM runs" });
    expect(error).toMatch(/no such column: nope/);
  });

  it("documents every table and column of the structured record in its description", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === "query")!.description!;
    const documented = new Map(
      [...description.matchAll(/^- (\w+)\(([^)]*)\)/gm)].map(([, table, columns]) => [
        table!,
        columns!.split(",").map((column) => column.trim()),
      ]),
    );

    const tables = await callTool(client, "query", {
      sql: `SELECT name FROM sqlite_master WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name`,
    });
    const actual = new Map<string, string[]>();
    for (const [table] of tables.rows as string[][]) {
      const columns = await callTool(client, "query", { sql: `SELECT name FROM pragma_table_info('${table}') ORDER BY cid` });
      actual.set(table!, (columns.rows as string[][]).map(([name]) => name!));
    }
    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(actual));
  });
});
