# AI Running Coach

Personal project for tracking my running training with AI-powered coaching. Training plans, weekly logs, and resources are managed through daily conversations with Claude, which acts as a running coach — providing structured plans, tracking progress, and adapting training based on daily metrics.

## Current Goal

See [`data/current-goal.md`](data/current-goal.md) for the active program, A-race, and phase map.

## Repository Structure

```
data/                            # Source-of-truth state (durable across programs)
  runs.csv                       # Global run log
  shoes.md                       # Shoe mileage log
  race-history.md                # Race results & PRs
  current-goal.md                # Active program & phase map

resources/                       # Shared protocols & routines
  hsr-protocols.md
  mobility-routines.md

programs/                        # All training programs
  2026-01-music-city-half/       # First half marathon build (completed Apr 25, 2026)
    logs/
    plans/
  ...                            # Future programs follow <YYYY>-<MM>-<short-name>

CLAUDE.md                        # Coaching framework, workflow, and runner profile (Claude reads this)
```

Program folder names use start date (`<YYYY>-<MM>-<short-name>`) so they sort chronologically.
