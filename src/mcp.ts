import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { registerBodyCompScanTools } from "./tools/body-comp-scans";
import { registerCheckInTools } from "./tools/check-ins";
import { registerDocumentTools } from "./tools/documents";
import { registerProgramTools } from "./tools/programs";
import { registerQueryTools } from "./tools/query";
import { registerRaceResultTools } from "./tools/race-results";
import { registerRunTools } from "./tools/runs";
import { registerSessionTools } from "./tools/session";
import { registerShoeTools } from "./tools/shoes";
import { registerStrengthSessionTools } from "./tools/strength-sessions";

/**
 * The MCP tools. Each is a thin wrapper over the domain core, named in the
 * domain language (CONTEXT.md), and registered by its area's module in
 * src/tools/.
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "ai-running-coach", version: "0.1.0" });
  registerSessionTools(server, env);
  registerProgramTools(server, env);
  registerRunTools(server, env);
  registerShoeTools(server, env);
  registerDocumentTools(server, env);
  registerStrengthSessionTools(server, env);
  registerCheckInTools(server, env);
  registerBodyCompScanTools(server, env);
  registerRaceResultTools(server, env);
  registerQueryTools(server, env);
  return server;
}

/** The MCP API: the Worker's `/mcp` route, behind OAuth (src/auth). Tests call it directly. */
export const mcpApi = {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
