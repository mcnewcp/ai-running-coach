import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { athleteTimezone, localDate, WEEKDAYS } from "./core/calendar";

/**
 * The MCP tools. Each is a thin wrapper over the domain core, named in the
 * domain language (CONTEXT.md).
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "ai-running-coach", version: "0.1.0" });

  server.registerTool(
    "today",
    {
      title: "Today",
      description:
        "Today's local calendar date and weekday in the athlete's timezone. " +
        "Use it instead of assuming the date: every record date is a local date in this timezone.",
      outputSchema: z.object({
        date: z.string().describe("ISO 8601 calendar date, e.g. 2026-09-24"),
        weekday: z.enum(WEEKDAYS),
        timezone: z.string().describe("The athlete's IANA timezone"),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => structured(localDate(new Date(), athleteTimezone(env))),
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
