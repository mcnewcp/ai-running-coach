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
- [`src/auth/`](src/auth/): OAuth in front of `/mcp`, signing in with GitHub.
- [`src/index.ts`](src/index.ts): the Worker entry point.

### Sign-in

The Worker is its own OAuth authorization server for MCP clients, built on [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider), and GitHub is the identity step. A client like claude.ai registers itself and sends the runner to `/authorize`. That shows a consent page, then hands over to GitHub, and `/callback` gives out a grant only to a GitHub user on the allowlist. The allowlist is `ALLOWED_GITHUB_USERS` in [`wrangler.jsonc`](wrangler.jsonc), a comma-separated list of GitHub usernames. Every `/mcp` request checks it again, so removing someone cuts off the tokens they already hold.

The allowlist matches GitHub usernames, which can change, not numeric user ids, which can't. If an allowlisted user renames their GitHub account, the tokens they already hold keep working, and anyone who then registers the old username can sign in. After a rename, update the allowlist straight away.

The Worker asks GitHub for no scopes and keeps only the username. OAuth clients, grants and tokens (stored only as hashes) live in KV (binding `OAUTH_KV`). A connection lasts while it's used: it ends after 90 days without any use.

### Time

Record dates are local calendar dates, and weeks run Monday–Sunday over those dates. `today` works out what day it is for the runner. It uses the **Home Timezone** unless the coach passes the runner's current timezone, e.g. while they're travelling ([ADR 0004](docs/adr/0004-the-coach-supplies-the-runners-current-timezone.md)). Until the Runner Profile holds the Home Timezone (#8, #9), it's a temporary default in [`src/core/calendar.ts`](src/core/calendar.ts).

### Local development

Needs Node.js 24.

```sh
npm install
npm run dev   # serves http://localhost:8787/mcp
```

D1, R2 and KV are simulated in `.wrangler/`. Sign-in works locally exactly as it does when deployed, because there's deliberately no switch that turns it off. To connect an MCP client locally (e.g. the MCP Inspector, `npx @modelcontextprotocol/inspector`, with the Streamable HTTP transport):

1. Create a second GitHub OAuth app for development (see [Deployment](#deployment)) with the callback URL `http://localhost:8787/callback`.
2. Put its credentials in `.dev.vars` (gitignored):

   ```sh
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

For changes to tools you rarely need this: the tests call the tools without OAuth.

After changing `wrangler.jsonc`, run `npm run cf-typegen` to regenerate `worker-configuration.d.ts`.

### Testing

```sh
npm test            # run every test once
npm run test:watch  # rerun on change
npm run typecheck   # check types, and that worker-configuration.d.ts is current
```

CI runs the typecheck and the tests on every pull request.

Tests have **one seam: MCP tool calls.** Each test connects a real MCP client over Streamable HTTP to the Worker's MCP handler, running in the Workers runtime through the [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/). D1 (with every migration applied) and R2 are local, and each test file gets its own storage. OAuth is skipped. Tests assert on tool outputs and on what later tool calls observe, never on tables or internal functions. There are two exceptions. [`test/harness.test.ts`](test/harness.test.ts) checks the harness itself. [`test/oauth.test.ts`](test/oauth.test.ts) goes through the Worker's entry point and walks the whole sign-in like an MCP client does, with GitHub faked and the synthetic allowlist from [`vitest.config.ts`](vitest.config.ts).

- [`test/mcp.ts`](test/mcp.ts) has the helpers: `connect()` returns a connected client, `callTool` returns a tool's structured output, and `callToolExpectingError` returns a tool's error message.
- To test anything that depends on the current time, fake only the clock with `vi.useFakeTimers({ toFake: ["Date"] })` and set it with `vi.setSystemTime(...)`. The Worker runs in the same isolate as the tests, so it sees the fake clock. See [`test/today.test.ts`](test/today.test.ts).
- All test data is synthetic. Real Athlete Record data never goes in fixtures, tests, logs or issues.

## Deployment

```sh
npm run deploy
```

This runs the typecheck and the tests, applies any new D1 migrations to the remote database, and deploys the Worker. You need to be logged in to Cloudflare (`npx wrangler login`). The Worker serves `https://ai-running-coach.<your-subdomain>.workers.dev`.

### One-time setup

To deploy your own copy, do these once:

1. **Cloudflare resources.** Create the D1 database, R2 bucket and KV namespace, then put the D1 `database_id` and KV `id` that wrangler prints into [`wrangler.jsonc`](wrangler.jsonc):

   ```sh
   npx wrangler d1 create ai-running-coach
   npx wrangler r2 bucket create ai-running-coach-documents
   npx wrangler kv namespace create OAUTH_KV
   ```

2. **Allowlist.** Set `ALLOWED_GITHUB_USERS` in [`wrangler.jsonc`](wrangler.jsonc) to your GitHub username, or several, separated by commas.
3. **Deploy once with placeholder secrets** to get the Worker's URL. Wrangler won't create a Worker until its required secrets exist, and the GitHub OAuth app needs the URL first. Sign-in fails until step 5 replaces the placeholders:

   ```sh
   npx wrangler deploy --secrets-file <(printf 'GITHUB_CLIENT_ID=placeholder\nGITHUB_CLIENT_SECRET=placeholder\n')
   ```
4. **GitHub OAuth app.** At [GitHub → Settings → Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/applications/new), set the homepage URL to the Worker's URL and the redirect URI (formerly "authorization callback URL") to exactly `<Worker URL>/callback`. Generate a client secret.
5. **Secrets.** Store both values as Worker secrets, never in the repo. Each command prompts for the value and takes effect immediately. After this, `npm run deploy` is all you need:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

### Connecting Claude

In claude.ai, go to **Settings → Connectors → Add custom connector** and enter `<Worker URL>/mcp`. Then connect: approve the consent page and sign in with GitHub. The connector then works in the Claude apps, in Claude Code on the web, and in the Claude Code CLI when it's signed in to the same claude.ai account (it shows up under `/mcp`).


### Troubleshooting

- **Logs.** Watch live with `npx wrangler tail`. Past logs are under Workers Logs in the Cloudflare dashboard. Refused sign-ins are logged with the GitHub username.
- **"GitHub is temporarily refusing requests from Cloudflare's network".** GitHub sometimes blocks one of Cloudflare's shared outbound IPs for about five minutes (`429`, "Access to this site has been restricted"), whoever's traffic caused it. Try connecting again later. Only sign-in talks to GitHub, so an existing connection keeps working.
