import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ArchiveSource, mirrorDocuments, rebuildDocuments, rebuildStructuredRecord } from "../src/import";
import { archiveFixture, fixture } from "./archive-fixture";
import { callTool, connect, resetDatabase, resetDocuments } from "./mcp";

// The import rebuilds R2, the runner's vault, from the same checkout of the
// private archive as D1. These tests import the synthetic archive
// (test/fixtures/archive) into both stores, then check the vault through the
// MCP tools.

beforeEach(async () => {
  await resetDatabase();
  await resetDocuments();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Imports `archive` the way the import command does: D1, then R2. */
async function importArchive(archive: ArchiveSource = fixture) {
  await rebuildStructuredRecord(env.DB, archive);
  return rebuildDocuments({ db: env.DB, bucket: env.DOCUMENTS }, archive);
}

async function read(client: Awaited<ReturnType<typeof connect>>, path: string): Promise<string> {
  return ((await callTool(client, "read_document", { path })) as { content: string }).content;
}

describe("the document import", () => {
  it("writes the Runner Profile with the Home Timezone from the vault config, so today works", async () => {
    await importArchive();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-03-02T00:30:00Z"));
    const client = await connect();
    expect(await callTool(client, "today")).toEqual({
      date: "2031-03-02",
      weekday: "Sunday",
      timezone: "Europe/London",
      timezoneSource: "home",
    });
  });

  it("makes the Runner Profile of only the athlete-specific sections the vault config names", async () => {
    await importArchive();
    const client = await connect();
    const profile = await read(client, "Runner Profile.md");
    expect(profile).toBe(
      [
        "---",
        "timezone: Europe/London",
        "---",
        "# Runner Profile",
        "",
        "## Body",
        "",
        "- Age: 99 (synthetic)",
        "- Resting HR: 50 bpm (synthetic)",
        "",
        "## Health History",
        "",
        "- A synthetic sore ankle, managed with calf raises.",
        "- See the [synthetic rehab protocol](Resources/synthetic-rehab.md) for the exercises.",
        "",
        "## Daily Life",
        "",
        "```markdown",
        "## Not a heading: inside a code fence, with a [link](nowhere.md)",
        "```",
        "",
        "- Runs at lunch on a synthetic river path.",
        "",
        "## What Works",
        "",
        "- Synthetic strength: loves early mornings.",
        "",
        "## Reviewed Notes",
        "",
        "- Synthetic default shoe: trainer-red.",
        "",
      ].join("\n"),
    );
    expect(profile).not.toMatch(/Generic/);
  });

  it("puts every Plan and Log from every Program under Programs/, keeping the folder and file names", async () => {
    await importArchive();
    const client = await connect();
    const { documents } = (await callTool(client, "list_documents", { prefix: "Programs/" })) as {
      documents: { path: string }[];
    };
    expect(documents.map((d) => d.path)).toEqual([
      "Programs/2031-01-synthetic-spring-half/Logs/week-01.md",
      "Programs/2031-01-synthetic-spring-half/Logs/week-02.md",
      "Programs/2031-01-synthetic-spring-half/Plans/phase-1-base.md",
      "Programs/2031-01-synthetic-spring-half/Plans/race-day.md",
      "Programs/2031-04-synthetic-off-season/Logs/2031-04-13-recovery.md",
      "Programs/2031-04-synthetic-off-season/Plans/2031-04-13-recovery.md",
    ]);
  });

  it("lands every Plan at the vault path its Phase links, so the coaching context has the active Phase's Plan", async () => {
    await importArchive();
    const client = await connect();
    const { rows } = (await callTool(client, "query", {
      sql: "SELECT name, start_date, plan_path FROM phases WHERE plan_path IS NOT NULL ORDER BY start_date",
    })) as { rows: [string, string, string][] };
    expect(rows).toHaveLength(3);
    for (const [, , planPath] of rows) {
      expect(await read(client, planPath)).toMatch(/^# /);
    }

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-02-04T12:00:00Z"));
    const context = (await callTool(client, "get_coaching_context")) as {
      phase: { name: string };
      plan: { path: string; content: string } | null;
    };
    expect(context.phase.name).toBe("Base");
    expect(context.plan?.path).toBe("Programs/2031-01-synthetic-spring-half/Plans/phase-1-base.md");
    expect(context.plan?.content).toMatch(/^# Phase 1: Base\n/);
  });

  it("reports a Phase whose Plan the archive doesn't have", async () => {
    const report = await importArchive(
      archiveFixture({ "programs/2031-04-synthetic-off-season/plans/2031-04-13-recovery.md": null }),
    );
    expect(report.missing).toEqual([
      {
        source: "extraction/structure.json",
        message:
          "2031 Synthetic Off-season / Recovery links the Plan Programs/2031-04-synthetic-off-season/Plans/2031-04-13-recovery.md, " +
          "which isn't in the vault.",
      },
    ]);
  });

  it("writes each race's entry in the race history as its narrative under Races/, where its Race Result links", async () => {
    await importArchive();
    const client = await connect();
    const { documents } = (await callTool(client, "list_documents", { prefix: "Races/" })) as {
      documents: { path: string }[];
    };
    expect(documents.map((d) => d.path)).toEqual([
      "Races/2031-04-12-synthetic-city-half.md",
      "Races/2031-05-10-synthetic-park-5k.md",
    ]);
    const { rows } = (await callTool(client, "query", {
      sql: "SELECT narrative_path FROM race_results ORDER BY date",
    })) as { rows: [string][] };
    expect(rows.map(([path]) => path)).toEqual(documents.map((d) => d.path));
    expect(await read(client, "Races/2031-05-10-synthetic-park-5k.md")).toBe(
      [
        "# Synthetic Park 5K — May 10, 2031",
        "- **Result**: 26:01 net (chip) / 26:20 gun",
        "- **Distance / Pace**: 5K; ~8:23/mi",
        "- **Conditions**: 62°F, humid",
        "- **Avg HR**: 172 bpm",
        "- **Narrative**: Raced it as a tune-up.",
        "",
      ].join("\n"),
    );
  });

  it("copies the athlete-specific resources the vault config names into Resources/, and nothing else", async () => {
    await importArchive();
    const client = await connect();
    const { documents } = (await callTool(client, "list_documents", { prefix: "" })) as {
      documents: { path: string }[];
    };
    expect(documents.map((d) => d.path).filter((path) => !/^(Programs|Races)\//.test(path))).toEqual([
      "Resources/synthetic-rehab.md",
      "Runner Profile.md",
    ]);
    expect(await read(client, "Resources/synthetic-rehab.md")).toBe(
      "# Synthetic Rehab Protocol\n\nCalf raises, 3 x 15, for the synthetic sore ankle.\n\n" +
        "Progress it alongside the [mobility guide](https://example.com/framework/resources/generic-mobility.md).\n",
    );
  });

  it("rewrites links into the archive's layout to vault paths, or to a note pointing at the structured record", async () => {
    await importArchive();
    const client = await connect();
    const spring = "Programs/2031-01-synthetic-spring-half";
    expect(await read(client, `${spring}/Plans/phase-1-base.md`)).toBe(
      [
        "# Phase 1: Base",
        "",
        "Monday: rest. Tuesday: 3 mi easy.",
        "",
        "Logged in the [week 1 log](../Logs/week-01.md#tuesday), with the run data in runs.csv (structured record: Runs).",
        "Keep up the [rehab](../../../Resources/synthetic-rehab.md) and the " +
          '[mobility guide](https://example.com/framework/resources/generic-mobility.md "Generic").',
        "",
      ].join("\n"),
    );
    expect(await read(client, `${spring}/Plans/race-day.md`)).toMatch(
      "Results go in the [race history](../../../Races/2031-04-12-synthetic-city-half.md).",
    );
    expect(await read(client, `${spring}/Logs/week-01.md`)).toBe(
      [
        "# Week 1",
        "",
        "## Tuesday",
        "",
        "3 mi easy, as the [plan](../Plans/phase-1-base.md) said. Shoes in the shoe log (structured record: Shoes).",
        "Lifts in lifts.csv (structured record: Strength Sessions), scans in inbody.csv (structured record: Body-comp Scans).",
        "An old note points [nowhere](../../../notes/gone.md), and [the web](https://example.com/synthetic) stays as it is.",
        "",
      ].join("\n"),
    );
    expect(await read(client, `${spring}/Logs/week-02.md`)).toMatch(
      "Compare with [week 1](week-01.md), and see the [race plan](../Plans/race-day.md).",
    );
    expect(await read(client, "Programs/2031-04-synthetic-off-season/Plans/2031-04-13-recovery.md")).toMatch(
      "The goal notes (structured record: Programs and Phases) moved",
    );
    expect(await read(client, "Programs/2031-04-synthetic-off-season/Logs/2031-04-13-recovery.md")).toMatch(
      "Felt fresh after the [race](../../2031-01-synthetic-spring-half/Plans/race-day.md).",
    );
  });

  it("reports the links it couldn't rewrite, leaving them as they were", async () => {
    const report = await importArchive();
    expect(report.unrewrittenLinks).toEqual([
      {
        source: "programs/2031-01-synthetic-spring-half/logs/week-01.md:7",
        link: "[nowhere](../../../notes/gone.md)",
        reason: "notes/gone.md isn't in the vault, and extraction/vault.json doesn't say where links to it go.",
      },
    ]);
  });

  it("reports a section the vault config names that the archive doesn't have", async () => {
    const config = JSON.parse(fixture.read("extraction/vault.json")!) as {
      runnerProfile: { parts: { from: string; section?: string[] }[] };
    };
    config.runnerProfile.parts.push({ from: "CLAUDE.md", section: ["Runner Profile", "Synthetic Missing"] });
    const report = await importArchive(archiveFixture({ "extraction/vault.json": JSON.stringify(config) }));
    expect(report.missing).toEqual([
      {
        source: "extraction/vault.json runnerProfile.parts[3]",
        message: "CLAUDE.md has no section Runner Profile > Synthetic Missing.",
      },
    ]);
  });

  it("wipes the vault's documents before rebuilding it, leaving the rest of the bucket alone", async () => {
    const client = await connect();
    await callTool(client, "write_document", { path: "Stray/note.md", content: "# Stray\n", create_only: true });
    // Obsidian's own settings, synced to the bucket by Remotely Save.
    await env.DOCUMENTS.put(".obsidian/app.json", "{}");
    await importArchive();
    expect(await callTool(client, "list_documents", { prefix: "Stray/" })).toMatchObject({ documents: [] });
    // A named exception to the one seam (README, Testing): the tools refuse hidden paths, so read R2 directly.
    expect(await env.DOCUMENTS.get(".obsidian/app.json")).not.toBeNull();
  });

  it("copies the rebuilt vault to another bucket, as the remote target needs, wiping its documents first", async () => {
    await importArchive();
    // Stands in for the remote bucket: it has a stray document and Obsidian's settings.
    const remote = env.REMOTE_DOCUMENTS;
    await remote.put("Stray/note.md", "# Stray\n");
    await remote.put(".obsidian/app.json", "{}");

    await mirrorDocuments(env.DOCUMENTS, remote);

    const listing = async (bucket: R2Bucket) => {
      const { objects } = await bucket.list();
      return Promise.all(objects.map(async (o) => [o.key, o.etag, await (await bucket.get(o.key))!.text()]));
    };
    const local = await listing(env.DOCUMENTS);
    expect(local).toHaveLength(10);
    expect(await listing(remote)).toEqual([[".obsidian/app.json", expect.any(String), "{}"], ...local]);
  });

  it("gives identical results when run twice", async () => {
    const client = await connect();
    const vault = async () => {
      const { documents } = (await callTool(client, "list_documents", { prefix: "" })) as {
        documents: { path: string; version: string }[];
      };
      return Promise.all(documents.map(async ({ path, version }) => ({ path, version, content: await read(client, path) })));
    };
    const firstReport = await importArchive();
    const first = await vault();
    const secondReport = await importArchive();
    expect(secondReport).toEqual(firstReport);
    expect(await vault()).toEqual(first);
    expect(first).toHaveLength(10);
    expect(firstReport.written).toEqual(first.map((d) => d.path));
  });
});
