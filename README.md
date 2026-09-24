# AI Running Coach

An AI running coach built on Claude. It writes structured training plans, tracks every run, lift and check-in, and adapts training around the runner's goals, health and life, mostly through daily conversations.

This repo holds the **Coaching Framework** (the coaching method, which isn't about any one runner) and the **domain interface**: a remote MCP server that Claude uses to read and write the runner's **Athlete Record**. The Athlete Record itself never lives in this repo. See [ADR 0001](docs/adr/0001-athlete-record-lives-outside-the-repo.md).

- Domain vocabulary: [`CONTEXT.md`](CONTEXT.md)
- Architecture decisions: [`docs/adr/`](docs/adr/)

**Status:** v0.1 in progress. See the issue tracker.
