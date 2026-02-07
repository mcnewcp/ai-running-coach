# Technology Stack

**Analysis Date:** 2026-01-26

## Overview

This is a documentation-based personal running coaching project with no application code, frameworks, or dependencies. The repository consists entirely of markdown files for training planning and Claude AI system configuration.

## Languages

**Primary:**
- Markdown - Training plans, coaching logs, and resource documentation
- JSON - Configuration files only (`.claude/settings.json`)
- JavaScript (Node.js) - Minimal tooling only (hook scripts for version checking)

**No Production Code:**
- No TypeScript, Python, Java, Go, or compiled languages
- No application source code exists

## Runtime

**Environment:**
- Not applicable - no application runtime

**Package Manager:**
- npm (referenced in hook scripts for GSD version checking only)
- No package.json or lockfile in repository

## Frameworks

**None.** This is not a software application.

**Tooling Only:**
- Claude AI integration via `.claude/settings.json` for coaching workflow automation
- Get Shit Done (GSD) v1.9.13 - CLI framework for project orchestration (embedded in `.claude/get-shit-done/` directory, version 1.9.13)

## Key Dependencies

**None in application sense.**

**Indirect Dependencies:**
- Node.js runtime (for hook scripts only)
- npm (for GSD version checking in background process)

## Configuration

**Claude AI Configuration:**
- File: `/.claude/settings.json`
- Allowed Commands: `date` only (for training workflow)
- Hooks: SessionStart hook runs GSD update check
- Permissions: Git operations, basic bash utilities (echo, cat, ls, mkdir, wc, head, tail, sort, grep, tr)

**GSD Framework:**
- Version: 1.9.13 (file: `/.claude/get-shit-done/VERSION`)
- Location: `/.claude/get-shit-done/`
- Contains: Workflow definitions, agent specifications, command templates, and reference documentation

## Platform Requirements

**Development:**
- macOS (tested on Darwin 25.2.0, M-series Apple Silicon)
- Node.js runtime (for hook scripts)
- Claude AI application with custom commands support

**Production:**
- Not applicable - documentation-only project

## File Structure

**Core Files:**
- `CLAUDE.md` - Main coaching system context and instructions (13,105 bytes)
- `.claude/settings.json` - Claude AI configuration
- `.claude/get-shit-done/` - Embedded GSD CLI framework

**Project Structure:**
- `2026-music-city-half/` - Training program for Music City Half Marathon
  - `logs/` - Weekly training logs in markdown
  - `plans/` - Phase-based training plans
  - `resources/` - Coaching resources (mobility routines, HSR protocols, nutrition guidance)
- `future-races/` - Future race planning sections
- `.planning/codebase/` - Codebase documentation directory

## Build and Deployment

**No build process.** This is a documentation repository.

**No deployment.** Documentation is managed locally and via Claude AI conversations.

---

*Technology stack analysis: 2026-01-26*

**Key Finding:** This repository contains no application code, external dependencies, or technology stack. It is a documentation-based coaching system designed to be consumed by Claude AI through the Claude Code application.
