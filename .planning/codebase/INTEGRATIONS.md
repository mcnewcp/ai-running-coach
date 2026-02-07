# External Integrations

**Analysis Date:** 2026-01-26

## Overview

This is a documentation-based coaching project with no external API integrations, databases, or third-party services. The system operates entirely within Claude AI conversations using structured markdown files.

## APIs & External Services

**None.** No external APIs are integrated.

**Indirect Reference Only:**
- npm registry (checked in background for GSD version updates via `npm view get-shit-done-cc version`)
  - File: `/.claude/hooks/gsd-check-update.js`
  - Purpose: Check if newer version of Get Shit Done CLI is available
  - Not a critical dependency - cache-based, non-blocking check

## Data Storage

**File Storage:**
- Local filesystem only - all data stored as markdown files in repository
- No database

**File Locations:**
- Training logs: `2026-music-city-half/logs/*.md`
- Training plans: `2026-music-city-half/plans/*.md`
- Resources: `2026-music-city-half/resources/*.md`
- Coaching context: `CLAUDE.md`

**No Cloud Storage:**
- No S3, cloud blob storage, or file hosting services
- All files managed locally in git repository

**Caching:**
- Local cache directory: `~/.claude/cache/gsd-update-check.json`
- Stores results of npm version check (not critical data)

## Authentication & Identity

**Not applicable.** No external authentication providers.

**Local Authentication:**
- Claude AI application handles user authentication
- No auth tokens, API keys, or credentials required for project files

## Monitoring & Observability

**Error Tracking:**
- Not implemented - no external error tracking service
- Issues logged as markdown comments in training logs

**Logs:**
- Weekly training logs stored as markdown files in `2026-music-city-half/logs/`
- Not aggregated to external logging service

**Performance Monitoring:**
- Not applicable - documentation-only project

## CI/CD & Deployment

**Hosting:**
- Local repository only
- No remote hosting, GitHub Pages, or CI pipeline

**CI Pipeline:**
- Not implemented - no automated testing or deployment

**Deployment:**
- Manual sync via git (if needed)
- No production deployment

## Environment Configuration

**Required Environment Variables:**
- None required for core functionality

**Optional Environment:**
- Node.js PATH for hook scripts (for GSD version checking)

**Configuration Files:**
- `/.claude/settings.json` - Claude AI integration settings
- `CLAUDE.md` - Coaching system context and parameters

## Data Sources

**Apple Health Data (Referenced but Not Integrated):**
- Resting heart rate tracking (user manually reports from Apple Health)
- VO2 max tracking (user manually reports from Apple Health)
- Sleep data (user manually reports)

**Entry Method:** Manual reporting in training logs and daily conversations with Claude AI

**No API Connection:** Data is not automatically synced from any health platform

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## External References (No Integration)

The project mentions training with wearable devices and health apps but does not integrate with them:
- Apple Health (referenced in CLAUDE.md for tracking resting HR and VO2 max)
- Lifetime Fitness gym (referenced as training location, no API integration)
- Peloton treadmill (referenced as equipment, no API integration)

Users manually report metrics from these systems to Claude AI during daily coaching sessions.

---

*Integration audit: 2026-01-26*

**Key Finding:** This repository has no external API integrations, database connections, or third-party service dependencies. It is a self-contained documentation system designed for local use with Claude AI. All coaching data is manually entered by the user and stored as markdown files in the git repository.
