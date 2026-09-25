# AI Running Coach

An AI running coach built on Claude. It writes structured training plans, tracks every run, lift and check-in, and adapts training around the runner's goals, health and life, mostly through daily conversations.

This repo holds the **Coaching Framework** (the coaching method, which isn't about any one runner) and the **domain interface**: a remote MCP server that Claude uses to read and write the runner's **Athlete Record**. The Athlete Record itself never lives in this repo. See [ADR 0001](docs/adr/0001-athlete-record-lives-outside-the-repo.md).

- Domain vocabulary: [`CONTEXT.md`](CONTEXT.md)
- Architecture decisions: [`docs/adr/`](docs/adr/)

**Status:** v0.1 in progress. See the issue tracker.

## The domain interface

A TypeScript [Cloudflare Worker](https://developers.cloudflare.com/workers/) serves the MCP tools over Streamable HTTP on `/mcp` ([ADR 0002](docs/adr/0002-cloudflare-worker-d1-r2-with-obsidian-via-remotely-save.md)). The structured Athlete Record lives in D1 (binding `DB`, schema in [`migrations/`](migrations/)) and the documents in R2 (binding `DOCUMENTS`).

- [`src/core/`](src/core/): the domain core, which holds the business logic.
- [`src/mcp.ts`](src/mcp.ts): the MCP tools, a thin wrapper over the core.
- [`src/index.ts`](src/index.ts): the Worker entry point.

### Settings

| Setting            | What it is                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `ATHLETE_TIMEZONE` | The athlete's IANA timezone, e.g. `America/New_York`. Every record date is a local date in it, and weeks run Monday–Sunday in it. |

Settings describe the athlete, so they stay out of this repo: locally in `.dev.vars` (gitignored), and on Cloudflare as Worker secrets (`npx wrangler secret put ATHLETE_TIMEZONE`).

### Local development

Needs Node.js 24.

```sh
npm install
cp .dev.vars.example .dev.vars   # then set your own values
npm run dev                      # serves http://localhost:8787/mcp
```

Any MCP client can connect to `http://localhost:8787/mcp`. For example, the MCP Inspector (`npx @modelcontextprotocol/inspector`) with the Streamable HTTP transport. Locally there's no OAuth, and D1 and R2 are simulated in `.wrangler/`.

After changing `wrangler.jsonc`, run `npm run cf-typegen` to regenerate `worker-configuration.d.ts`.

### Testing

```sh
npm test            # run every test once
npm run test:watch  # rerun on change
npm run typecheck   # check types, and that worker-configuration.d.ts is current
```

CI runs the typecheck and the tests on every pull request.

Tests have **one seam: MCP tool calls.** Each test connects a real MCP client over Streamable HTTP to the Worker's MCP handler, running in the Workers runtime through the [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/). D1 (with every migration applied) and R2 are local, and each test file gets its own storage. OAuth is skipped. Tests assert on tool outputs and on what later tool calls observe, never on tables or internal functions. The one exception is [`test/harness.test.ts`](test/harness.test.ts), which checks the harness itself.

- [`test/mcp.ts`](test/mcp.ts) has the helpers: `connect(settings?)` returns a connected client (optionally with overridden settings), `callTool` returns a tool's structured output, and `callToolExpectingError` returns a tool's error message.
- To test anything that depends on the current time, fake only the clock with `vi.useFakeTimers({ toFake: ["Date"] })` and set it with `vi.setSystemTime(...)`. The Worker runs in the same isolate as the tests, so it sees the fake clock. See [`test/today.test.ts`](test/today.test.ts).
- Tests use the synthetic settings in [`vitest.config.ts`](vitest.config.ts), never your `.dev.vars`. Pass `connect({ ATHLETE_TIMEZONE: ... })` to try another value.
- All test data is synthetic. Real Athlete Record data never goes in fixtures, tests, logs or issues.
