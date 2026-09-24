# The Athlete Record lives outside the repo

The repo is a public resource. It holds only the Coaching Framework (method, principles, generic protocols) and the code that serves it. Everything about a specific athlete (Runner Profile, Programs, Plans, Logs, Runs, Strength Sessions, Check-ins, scans, Race Results) lives in external stores, reached only through the domain interface. The repo is shaped this way so that it can be published, and later used as a template, without leaking personal and medical data. It also means the Athlete Record is reachable from local sessions, Claude Code web and a future web app, not only from wherever the repo happens to be checked out.

## Consequences

- Git history is not a safe place to remove personal data from, so the public repo started with fresh history. The original repo stays private as an archive.
- `CLAUDE.md` must never contain athlete specifics. Coaching sessions load the athlete's context through the interface at session start.
