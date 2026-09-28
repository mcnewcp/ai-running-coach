import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { today, WEEKDAYS } from "./core/calendar";

/**
 * The MCP tools. Each is a thin wrapper over the domain core, named in the
 * domain language (CONTEXT.md).
 */
export function createServer(_env: Env): McpServer {
  const server = new McpServer({ name: "ai-running-coach", version: "0.1.0" });

  server.registerTool(
    "today",
    {
      title: "Today",
      description:
        "What day it is for the runner: today's local calendar date and weekday. " +
        "Call it instead of assuming the date. It uses the runner's Home Timezone unless you pass " +
        "the runner's current timezone, e.g. while they're travelling.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            "The runner's current IANA timezone (e.g. Europe/London), when you know they're away from home. " +
              "Omit it to use the Home Timezone. Abbreviations like CST are rejected.",
          ),
      }),
      outputSchema: z.object({
        date: z.string().describe("ISO 8601 calendar date, e.g. 2026-09-24"),
        weekday: z.enum(WEEKDAYS),
        timezone: z.string().describe("The IANA timezone the date is local to"),
        timezoneSource: z
          .enum(["home", "given"])
          .describe("home: the Home Timezone. given: the timezone you passed"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ timezone }) => structured(today(new Date(), timezone)),
  );

  return server;
}

function structured<T extends Record<string, unknown>>(output: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

/** The MCP API: the Worker's `/mcp` route, and what OAuth will sit in front of. */
export const mcpApi = {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
