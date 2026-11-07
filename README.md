# AI Running Coach

An AI running coach built on Claude. It writes structured training plans, tracks every run, lift and check-in, and adapts training around the runner's goals, health and life, mostly through daily conversations.

This repo holds the **Coaching Framework** (the coaching method, which isn't about any one runner) and the **domain interface**: a remote MCP server that Claude uses to read and write the runner's **Athlete Record**. The Athlete Record itself never lives in this repo. See [ADR 0001](docs/adr/0001-athlete-record-lives-outside-the-repo.md).

- Domain vocabulary: [`CONTEXT.md`](CONTEXT.md)
- Architecture decisions: [`docs/adr/`](docs/adr/)

**Status:** v0.1 in progress. See the issue tracker.

## The domain interface

A TypeScript [Cloudflare Worker](https://developers.cloudflare.com/workers/) serves the MCP tools over Streamable HTTP on `/mcp` ([ADR 0002](docs/adr/0002-cloudflare-worker-d1-r2-with-obsidian-via-remotely-save.md)). The structured Athlete Record lives in D1 (binding `DB`, schema in [`migrations/`](migrations/)) and the documents in R2 (binding `DOCUMENTS`).

- [`src/core/`](src/core/): the domain core, which holds the business logic.
- [`src/mcp.ts`](src/mcp.ts) and [`src/tools/`](src/tools/): the MCP tools, a thin wrapper over the core.
- [`src/auth/`](src/auth/): OAuth in front of `/mcp`, signing in with GitHub.
- [`src/index.ts`](src/index.ts): the Worker entry point.

### Sign-in

The Worker is its own OAuth authorization server for MCP clients, built on [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider), and GitHub is the identity step. A client like claude.ai registers itself and sends the runner to `/authorize`. That shows a consent page, then hands over to GitHub, and `/callback` gives out a grant only to a GitHub user on the allowlist. The allowlist is `ALLOWED_GITHUB_USERS` in [`wrangler.jsonc`](wrangler.jsonc), a comma-separated list of GitHub usernames. Every `/mcp` request checks it again, so removing someone cuts off the tokens they already hold.

The allowlist matches GitHub usernames, which can change, not numeric user ids, which can't. If an allowlisted user renames their GitHub account, the tokens they already hold keep working, and anyone who then registers the old username can sign in. After a rename, update the allowlist straight away.

The Worker asks GitHub for no scopes and keeps only the username. OAuth clients, grants and tokens (stored only as hashes) live in KV (binding `OAUTH_KV`). A connection lasts while it's used: it ends after 90 days without any use.

### Time

Record dates are local calendar dates, and weeks run Monday–Sunday over those dates. `today` works out what day it is for the runner. It uses the **Home Timezone** unless the coach passes the runner's current timezone, e.g. while they're travelling ([ADR 0004](docs/adr/0004-the-coach-supplies-the-runners-current-timezone.md)). Until the Runner Profile holds the Home Timezone (#8, #9), it's a temporary default in [`src/core/calendar.ts`](src/core/calendar.ts).

### Programs and Phases

`upsert_program` and `upsert_phase` define how the season is structured. Programs tile the calendar and Phases tile their Program, so every day belongs to exactly one Phase. A race build ends on its A-race day with a one-day Race Phase. A bridge has neither. Writes that would leave a gap or overlap are rejected. When an existing window changes, the neighbour on each side moves its shared edge to keep meeting it. A change that would swallow or split a neighbour, or move a neighbouring race build's A-race day, is rejected instead.

Records never store a Phase or Program ([ADR 0003](docs/adr/0003-phase-membership-is-derived-from-date.md)). They belong to whichever Phase their date falls in. `phase_for_date` answers that over MCP. In the core, `placeDate(db, date)` returns the Program and Phase, or fails with a clear message if no Phase covers the date. `findPlacement(db, date)` returns `null` instead. Both are in [`src/core/programs.ts`](src/core/programs.ts). Use them to validate and attribute any dated record.

### Runs, Shoes and the Mileage Cap

`log_run`, `update_run` and `delete_run` record Runs. A Run is rejected if no Phase covers its date, its Shoe is unknown (or was retired before that date), or its distance isn't positive. Fields the runner didn't report stay empty, and pace is derived from distance and duration. `update_run` takes the Run's `id` and only the fields to change: omitted fields are kept, and `null` clears one. Like the other dated records, `log_run` and `update_run` return the Run with the Program and Phase its date falls in, and `delete_run` returns it as `deleted`. Each also returns where the Run's Monday–Sunday week stands against the Mileage Cap (`week`) and its Shoe's mileage (`shoe`). A correction also returns the week and Shoe the Run moved out of, if it did.

`add_shoe`, `retire_shoe` and `list_shoes` track Shoes. A Shoe's mileage and first and last Run dates are always derived from its Runs. Each pair is flagged as `nearingReplacement` once its mileage reaches `warnAtMiles`, 300 unless set when it's added.

The Mileage Cap is the previous Monday–Sunday week's actual miles × 1.10. `check_mileage_cap(proposed_week_miles, week?)` answers whether a proposed week exceeds it, and never blocks anything: the runner decides. In the core, `weekStanding(db, date)` and `checkMileageCap(db, proposed, date)` in [`src/core/mileage-cap.ts`](src/core/mileage-cap.ts) do that arithmetic. For "this week", pass today's local date.

### Strength Sessions, Daily Check-ins, Body-comp Scans and Race Results

Each of these is dated, so each write returns the record with the Program and Phase its date falls in, and a record dated outside every Phase is rejected. Anything the runner didn't report stays empty. Corrections keep the fields they leave out, and `null` clears one.

- **Strength Sessions:** `log_strength_session`, `update_strength_session` and `delete_strength_session`. A session holds one entry per exercise (pattern, exercise, load, load basis, sets, reps per set, notes). A correction that gives `entries` replaces the whole list.
- **Daily Check-ins:** `log_check_in` and `delete_check_in`. There's at most one Check-in per date. A later `log_check_in` for the same date merges into it and reports `status: "updated"`, so it doubles as the correction tool.
- **Body-comp Scans:** `log_body_comp_scan`, `update_body_comp_scan` and `delete_body_comp_scan`. A scan holds only the metrics its printout shows, and needs at least one.
- **Race Results:** `log_race_result`, `update_race_result` and `delete_race_result`. Each links to its narrative document by vault path. Its `kind` is derived, never stored: `a_race` if a Program names it (a race build ends on its A-race day), otherwise `tune_up`. `list_prs` derives the fastest official time at each distance, matching distances ignoring case and spaces.

### Documents

The unstructured Athlete Record (the Runner Profile, Plans, Logs and race narratives) is plain markdown in the R2 bucket. The runner browses and occasionally edits it as an Obsidian vault, synced to the same bucket by the Remotely Save plugin ([ADR 0002](docs/adr/0002-cloudflare-worker-d1-r2-with-obsidian-via-remotely-save.md)). A document's R2 key is its path in the vault. The vault is laid out like this:

```text
Runner Profile.md
Programs/
  <YYYY-MM-name>/          e.g. 2026-01-spring-half
    Plans/…                the Program's and its Phases' Plans
    Logs/…                 weekly and Phase Logs
Races/
  <YYYY-MM-DD>-<race>.md   race narratives, linked from their Race Results
Resources/…                resources specific to this runner. Generic protocols stay in this repo.
```

The Runner Profile holds the **Home Timezone** as a property in its frontmatter, so the runner can change it in Obsidian:

```markdown
---
timezone: America/Chicago
---
# Runner Profile
…
```

The tools are `list_documents(prefix)`, `read_document(path)` and `write_document(path, content, …)`. A document path is relative, `/`-separated and ends in `.md`. Paths that would leave the vault (`..`), absolute paths, and hidden folders or files (anything starting with `.`, like Obsidian's `.obsidian/` settings) are rejected, and `list_documents` leaves out anything that isn't a document.

Writes never silently overwrite the runner's edits. `read_document` returns a version (the R2 ETag), and `write_document` either updates with `expected_version`, the version it read, or creates with `create_only: true`. R2 checks that condition atomically as it writes. If it fails (the document changed or was deleted since, or already exists when creating), nothing is written and the result is a `conflict` with the current content and version, so the coach can merge and retry.

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

Tests have **one seam: MCP tool calls.** Each test connects a real MCP client over Streamable HTTP to the Worker's MCP handler, running in the Workers runtime through the [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/). D1 (with every migration applied) and R2 are local, and each test file gets its own storage. OAuth is skipped. Tests assert on tool outputs and on what later tool calls observe, never on tables or internal functions. [`test/documents.test.ts`](test/documents.test.ts) does write to the R2 bucket directly, but only to stand in for the runner's Obsidian vault, which Remotely Save syncs straight to the bucket. Beyond that there are two exceptions. [`test/harness.test.ts`](test/harness.test.ts) checks the harness itself. [`test/oauth.test.ts`](test/oauth.test.ts) goes through the Worker's entry point and walks the whole sign-in like an MCP client does, with GitHub faked and the synthetic allowlist from [`vitest.config.ts`](vitest.config.ts).

- [`test/mcp.ts`](test/mcp.ts) has the helpers: `connect()` returns a connected client, `callTool` returns a tool's structured output, and `callToolExpectingError` returns a tool's error message. Tests in one file share storage, so `resetDatabase()` (in `beforeEach`) empties every D1 table for tests that need a blank Athlete Record.
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
