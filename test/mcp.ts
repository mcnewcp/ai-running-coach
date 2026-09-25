// The project's single test seam: tests call MCP tools through a real MCP
// client, over Streamable HTTP, against the Worker's MCP handler running in
// the Workers runtime with local D1 and R2. OAuth is skipped by calling the
// handler that sits behind it.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { onTestFinished } from "vitest";
import { mcpApi } from "../src/mcp";

export type Settings = Partial<Pick<Env, "ATHLETE_TIMEZONE">>;

/**
 * Connects an MCP client to the Worker. `settings` override Worker settings
 * for this connection only. The client is closed when the test finishes.
 */
export async function connect(settings: Settings = {}): Promise<Client> {
  const testEnv: Env = { ...env, ...settings };
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (input, init) => {
      const request = new Request(input, init) as Request<unknown, IncomingRequestCfProperties>;
      // Real incoming requests always carry Host; the MCP handler checks it.
      request.headers.set("Host", new URL(request.url).host);
      return mcpApi.fetch(request, testEnv, createExecutionContext());
    },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  onTestFinished(() => client.close());
  return client;
}

/** Calls a tool that is expected to succeed and returns its structured output. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`Tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  if (!result.structuredContent) {
    throw new Error(`Tool ${name} returned no structured output`);
  }
  return result.structuredContent as Record<string, unknown>;
}

/** Calls a tool that is expected to fail and returns its error text. */
export async function callToolExpectingError(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError) {
    throw new Error(`Tool ${name} succeeded unexpectedly: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}
