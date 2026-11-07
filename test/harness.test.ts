// Checks the harness itself, so this is the one file that touches bindings
// directly. Later tickets rely on these pieces being there.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { connect } from "./mcp";

describe("test harness", () => {
  it("reaches the Worker's tools through an MCP client", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("today");
  });

  it("has a local D1 database with every migration applied", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
    expect(results.map((row) => row.name)).toEqual(env.TEST_MIGRATIONS.map((m) => m.name));
  });

  it("has a local R2 bucket", async () => {
    await env.DOCUMENTS.put("harness-check.md", "# Synthetic");
    const object = await env.DOCUMENTS.get("harness-check.md");
    expect(await object?.text()).toBe("# Synthetic");
  });
});
