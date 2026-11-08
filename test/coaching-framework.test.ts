// The Coaching Framework (CLAUDE.md and resources/) tells the coach which MCP
// tools to call. These tests keep it from drifting away from the tools the
// server actually registers. vitest.config.ts reads the documents from disk
// and passes them in as the FRAMEWORK binding.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { connect } from "./mcp";

const { documents, paths } = env.FRAMEWORK;

/** Every tool name, property name and enum value the MCP server exposes. */
async function interfaceVocabulary(): Promise<Set<string>> {
  const client = await connect();
  const { tools } = await client.listTools();
  const words = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && value !== null && typeof value === "object") {
        Object.keys(value).forEach((name) => words.add(name));
      }
      if (key === "enum" || key === "const") {
        [value].flat().forEach((v) => typeof v === "string" && words.add(v));
      }
      walk(value);
    }
  };
  for (const tool of tools) {
    words.add(tool.name);
    walk(tool.inputSchema);
    walk(tool.outputSchema);
  }
  return words;
}

/**
 * The identifiers a document names in code spans: `name`, or `name(args)`
 * with each argument's name. Other code spans (paths, values) are left alone.
 */
function namedIdentifiers(markdown: string): string[] {
  const names: string[] = [];
  for (const [, span] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const call = /^([A-Za-z_]\w*)(?:\((.*)\))?$/.exec(span!);
    if (!call) continue;
    names.push(call[1]!);
    for (const arg of (call[2] ?? "").split(",")) {
      const name = /^\s*([A-Za-z_]\w*)\??\s*$/.exec(arg)?.[1];
      if (name) names.push(name);
    }
  }
  return names;
}

describe("the Coaching Framework", () => {
  it("has a CLAUDE.md and generic protocols in resources/", () => {
    expect(Object.keys(documents)).toContain("CLAUDE.md");
    expect(Object.keys(documents).some((path) => path.startsWith("resources/"))).toBe(true);
  });

  it("names only tools, parameters, fields and values the MCP server has", async () => {
    const vocabulary = await interfaceVocabulary();
    const unknown = Object.entries(documents).flatMap(([path, markdown]) =>
      namedIdentifiers(markdown)
        .filter((name) => !vocabulary.has(name))
        .map((name) => `${path}: ${name}`),
    );
    expect(unknown).toEqual([]);
  });

  it("links only to files in the repo", () => {
    const exists = (path: string) =>
      paths.some((p) => p === path || p.startsWith(path.endsWith("/") ? path : `${path}/`));
    const broken = Object.entries(documents).flatMap(([path, markdown]) =>
      [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
        .map(([, target]) => target!.split("#")[0]!)
        .filter((target) => target !== "" && !/^[a-z]+:/i.test(target))
        .filter((target) => !exists(new URL(target, `file:///${path}`).pathname.slice(1)))
        .map((target) => `${path}: ${target}`),
    );
    expect(broken).toEqual([]);
  });
});
