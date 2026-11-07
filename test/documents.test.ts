import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { callTool, callToolExpectingError, connect } from "./mcp";

// Every document here is synthetic. Storage is shared by the tests in this
// file, so each test uses its own paths.

/**
 * The runner's Obsidian vault. Remotely Save syncs it with the R2 bucket
 * directly, not through the tools, so it's the one thing here that touches the
 * bucket.
 */
const obsidian = env.DOCUMENTS;

describe("documents", () => {
  it("creates a new document and reads it back with its version", async () => {
    const client = await connect();
    const path = "Programs/2026-01-synthetic-build/Plans/week-01.md";
    const content = "# Week 1\n\nMonday: rest\nTuesday: 3 mi easy\n";

    const written = await callTool(client, "write_document", { path, content, create_only: true });
    expect(written).toMatchObject({ status: "written", path });
    expect(written.version).toEqual(expect.any(String));

    expect(await callTool(client, "read_document", { path })).toEqual({
      path,
      content,
      version: written.version,
    });
  });

  describe("updating with the version that was read", () => {
    it("writes when the document hasn't changed since", async () => {
      const client = await connect();
      const path = "Programs/2026-01-synthetic-build/Logs/week-01.md";
      await callTool(client, "write_document", { path, content: "# Week 1 log\n", create_only: true });
      const read = await callTool(client, "read_document", { path });

      const written = await callTool(client, "write_document", {
        path,
        content: "# Week 1 log\n\nAll runs done.\n",
        expected_version: read.version,
      });
      expect(written).toMatchObject({ status: "written", path });
      expect(written.version).not.toBe(read.version);

      expect(await callTool(client, "read_document", { path })).toEqual({
        path,
        content: "# Week 1 log\n\nAll runs done.\n",
        version: written.version,
      });
    });

    it("is a conflict when the document changed since, returns the current one, and writes nothing", async () => {
      const client = await connect();
      const path = "Programs/2026-01-synthetic-build/Plans/week-02.md";
      await callTool(client, "write_document", { path, content: "# Week 2\n", create_only: true });
      const coachRead = await callTool(client, "read_document", { path });
      // Meanwhile the runner edits the Plan in Obsidian.
      const runnerEdit = await callTool(client, "write_document", {
        path,
        content: "# Week 2\n\nSwapped Tuesday and Thursday.\n",
        expected_version: coachRead.version,
      });

      const result = await callTool(client, "write_document", {
        path,
        content: "# Week 2\n\nAdded strides on Friday.\n",
        expected_version: coachRead.version,
      });
      expect(result).toMatchObject({
        status: "conflict",
        path,
        content: "# Week 2\n\nSwapped Tuesday and Thursday.\n",
        version: runnerEdit.version,
      });
      expect(result.message).toMatch(/changed since/);

      expect(await callTool(client, "read_document", { path })).toEqual({
        path,
        content: "# Week 2\n\nSwapped Tuesday and Thursday.\n",
        version: runnerEdit.version,
      });
    });

    it("is a conflict when the document was deleted since", async () => {
      const client = await connect();
      const path = "Programs/2026-01-synthetic-build/Plans/week-03.md";
      const created = await callTool(client, "write_document", {
        path,
        content: "# Week 3\n",
        create_only: true,
      });
      // The runner deletes it in Obsidian; Remotely Save deletes it from R2.
      await obsidian.delete(path);

      const result = await callTool(client, "write_document", {
        path,
        content: "# Week 3\n\nRecovery week.\n",
        expected_version: created.version,
      });
      expect(result).toMatchObject({ status: "conflict", path, content: null, version: null });
      expect(result.message).toMatch(/no longer exists/);
      expect(await callToolExpectingError(client, "read_document", { path })).toMatch(/no document/);
    });
  });

  describe("a write", () => {
    it("must either create only or give the version it read", async () => {
      const client = await connect();
      const path = "Resources/synthetic-mobility.md";
      await callTool(client, "write_document", { path, content: "# Mobility\n", create_only: true });
      const { version } = await callTool(client, "read_document", { path });

      for (const args of [
        {},
        { create_only: false },
        { create_only: true, expected_version: version },
      ]) {
        expect(
          await callToolExpectingError(client, "write_document", { path, content: "# Overwrite\n", ...args }),
        ).toMatch(/create_only.*expected_version/);
      }
      expect(await callTool(client, "read_document", { path })).toMatchObject({ content: "# Mobility\n" });
    });

    it("rejects a version that isn't one read_document returned", async () => {
      const client = await connect();
      const path = "Resources/synthetic-warmup.md";
      await callTool(client, "write_document", { path, content: "# Warm-up\n", create_only: true });

      for (const expected_version of ["*", "", '"abc"', "W/abc"]) {
        expect(
          await callToolExpectingError(client, "write_document", { path, content: "# Overwrite\n", expected_version }),
        ).toMatch(/version/);
      }
      expect(await callTool(client, "read_document", { path })).toMatchObject({ content: "# Warm-up\n" });
    });
  });

  describe("listing", () => {
    const program = "Programs/2026-06-synthetic-listing";

    it("lists the documents under a prefix, with their versions", async () => {
      const client = await connect();
      const versions: Record<string, unknown> = {};
      for (const path of [`${program}/Plans/week-02.md`, `${program}/Plans/week-01.md`, `${program}/Logs/week-01.md`]) {
        const written = await callTool(client, "write_document", { path, content: "# Synthetic\n", create_only: true });
        versions[path] = written.version;
      }

      expect(await callTool(client, "list_documents", { prefix: `${program}/Plans/` })).toEqual({
        prefix: `${program}/Plans/`,
        documents: [
          { path: `${program}/Plans/week-01.md`, version: versions[`${program}/Plans/week-01.md`] },
          { path: `${program}/Plans/week-02.md`, version: versions[`${program}/Plans/week-02.md`] },
        ],
      });

      const all = await callTool(client, "list_documents", { prefix: program });
      expect((all.documents as { path: string }[]).map((d) => d.path)).toEqual([
        `${program}/Logs/week-01.md`,
        `${program}/Plans/week-01.md`,
        `${program}/Plans/week-02.md`,
      ]);
    });

    it("lists the whole vault when the prefix is omitted or empty", async () => {
      const client = await connect();
      const path = "Resources/synthetic-listing-check.md";
      await callTool(client, "write_document", { path, content: "# Synthetic\n", create_only: true });

      for (const args of [{}, { prefix: "" }]) {
        const { documents } = await callTool(client, "list_documents", args);
        expect((documents as { path: string }[]).map((d) => d.path)).toContain(path);
      }
    });

    it("leaves out anything that isn't a markdown document, like Obsidian's settings", async () => {
      const client = await connect();
      const folder = "Programs/2026-07-synthetic-hidden";
      await callTool(client, "write_document", { path: `${folder}/plan.md`, content: "# Plan\n", create_only: true });
      // Synced by Remotely Save from the vault, not written by the coach.
      await obsidian.put(`${folder}/chart.png`, "synthetic image");
      await obsidian.put(`${folder}/.trash/old.md`, "# Old\n");
      await obsidian.put(".obsidian/workspace.md", "# Synthetic\n");

      const { documents } = await callTool(client, "list_documents", { prefix: folder });
      expect((documents as { path: string }[]).map((d) => d.path)).toEqual([`${folder}/plan.md`]);
      const vault = await callTool(client, "list_documents", {});
      expect((vault.documents as { path: string }[]).map((d) => d.path)).not.toContain(".obsidian/workspace.md");
    });

    it("lists every document, however many there are", async () => {
      const client = await connect();
      const folder = "Programs/2026-08-synthetic-many/Logs";
      const count = 1005; // More than R2 returns in one page.
      await Promise.all(
        Array.from({ length: count }, (_, i) => obsidian.put(`${folder}/day-${String(i).padStart(4, "0")}.md`, "#\n")),
      );

      const { documents } = await callTool(client, "list_documents", { prefix: folder });
      expect(documents).toHaveLength(count);
    });

    it.each(["../", "/Programs", ".obsidian/", "Programs/../.."])("rejects the prefix %j", async (prefix) => {
      const client = await connect();
      expect(await callToolExpectingError(client, "list_documents", { prefix })).toMatch(/prefix/);
    });
  });

  describe("paths", () => {
    const invalid = [
      ["escapes the bucket root", "../outside.md"],
      ["escapes the bucket root", "Programs/../../outside.md"],
      ["is absolute", "/Runner Profile.md"],
      ["has a backslash", "Programs\\2026-01-synthetic-build\\Plans\\week-01.md"],
      ["has an empty segment", "Programs//week-01.md"],
      ["has a dot segment", "Programs/./week-01.md"],
      ["is hidden, like Obsidian's settings", ".obsidian/workspace.md"],
      ["is hidden, like Obsidian's settings", "Programs/.trash/week-01.md"],
      ["has a control character", "Programs/week\u0000-01.md"],
      ["isn't markdown", "Resources/notes.txt"],
      ["isn't markdown", "Runner Profile"],
      ["is empty", ""],
    ];

    it.each(invalid)("are rejected when the path %s: %j", async (_, path) => {
      const client = await connect();
      expect(await callToolExpectingError(client, "read_document", { path })).toMatch(/path/);
      expect(
        await callToolExpectingError(client, "write_document", { path, content: "# Synthetic\n", create_only: true }),
      ).toMatch(/path/);
    });

    it("may have spaces and other ordinary characters, as Obsidian file names do", async () => {
      const client = await connect();
      const path = "Races/2026-05-02 Synthetic Half (rainy).md";
      await callTool(client, "write_document", { path, content: "# Synthetic Half\n", create_only: true });
      expect(await callTool(client, "read_document", { path })).toMatchObject({ content: "# Synthetic Half\n" });
    });
  });

  describe("creating with the create-only flag", () => {
    it("fails if the document already exists, returns it, and writes nothing", async () => {
      const client = await connect();
      const path = "Races/2026-03-14-synthetic-10k.md";
      const original = await callTool(client, "write_document", {
        path,
        content: "# Synthetic 10K\n\nFelt strong.\n",
        create_only: true,
      });

      const result = await callTool(client, "write_document", {
        path,
        content: "# A different race story\n",
        create_only: true,
      });
      expect(result).toMatchObject({
        status: "conflict",
        path,
        content: "# Synthetic 10K\n\nFelt strong.\n",
        version: original.version,
      });
      expect(result.message).toMatch(/already exists/);

      expect(await callTool(client, "read_document", { path })).toMatchObject({
        content: "# Synthetic 10K\n\nFelt strong.\n",
        version: original.version,
      });
    });
  });
});
