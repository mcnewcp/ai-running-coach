# Cloudflare Worker + D1 + R2, with Obsidian syncing to R2

The domain interface is a remote MCP server on a Cloudflare Worker, added as a claude.ai custom connector with GitHub OAuth limited to an allowlist of users. The structured Athlete Record lives in D1 and the documents live as markdown in R2. The athlete browses and occasionally edits the documents in Obsidian, desktop and mobile, through the Remotely Save plugin syncing a vault to that same R2 bucket. A claude.ai connector reaches the local CLI, Claude Code web and the Claude apps without secrets in any container. Everything fits Cloudflare's free tier, and nothing depends on a machine at home staying up.

## Considered Options

- **Supabase**: rejected because free projects pause after 7 days of inactivity, and off-season coaching can be that quiet.
- **Hosting on the home devbox** (with a tunnel): rejected because availability would hinge on a home machine and we'd operate a public endpoint ourselves. The devbox is the nightly backup target instead.
- **Obsidian Sync headless client**: rejected because it's paid, in beta, and needs an always-on host with a filesystem, which a Worker isn't.
- **A git repo as the vault (Obsidian Git)**: rejected because the plugin is unreliable on mobile.

## Consequences

- Remotely Save's free conflict handling keeps the newer file. To protect the athlete's edits, the interface refuses to overwrite a document that changed since it was last read, using R2 conditional writes.
- D1 is SQLite, not Postgres. Moving to Neon later is possible but would be a migration.
