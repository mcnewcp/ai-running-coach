# Coding Conventions

**Analysis Date:** 2026-01-26

## Project Scope

This codebase is a personal coaching project with minimal production code. Only 2 utility scripts exist (145 lines total):
- `/.claude/hooks/gsd-check-update.js` - GSD update checker
- `/.claude/hooks/gsd-statusline.js` - Status line display utility

No formal code documentation, linting, or testing infrastructure is configured.

## Naming Patterns

**Files:**
- kebab-case with descriptive purpose prefix
- Example: `gsd-check-update.js`, `gsd-statusline.js`
- File names indicate function (check, status, etc.)

**Functions/Variables:**
- camelCase for all identifiers
- Descriptive names reflecting purpose: `cacheDir`, `projectVersionFile`, `installed`, `latest`
- Single-letter variables avoided; all variables are semantic

**Node.js Modules:**
- CommonJS `require()` syntax (not ES6 imports)
- Examples from codebase:
  ```javascript
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { spawn } = require('child_process');
  ```

## Code Style

**Formatting:**
- 2-space indentation (observed throughout)
- Single quotes for strings where used
- Semicolons present on all statements
- No formatter configured (no .prettierrc, eslint, or biome.json)

**Comments:**
- Shebang on executable files: `#!/usr/bin/env node`
- Inline comments for significant logic blocks
- Example from `gsd-statusline.js`:
  ```javascript
  // Context window display (shows USED percentage)
  // Build progress bar (10 segments)
  // Color based on usage
  ```
- Comments explain "why" not "what"

**Code Organization:**
- Requires at top of file
- Constants and configuration in upper section
- Main logic follows
- Example structure (from `gsd-check-update.js`):
  1. Shebang and module docstring
  2. Requires and imports
  3. Path construction and configuration
  4. Functional logic
  5. Process spawning and cleanup

## Error Handling

**Pattern:**
- Try-catch blocks for file I/O and JSON parsing
- Silent failures with empty catch blocks when appropriate (non-critical operations)
- Example from `gsd-check-update.js`:
  ```javascript
  try {
    installed = fs.readFileSync(projectVersionFile, 'utf8').trim();
  } catch (e) {}
  ```
- Rationale: Update checks failing silently prevents disrupting user workflow

**Null/Undefined Handling:**
- Explicit null checks before operations
- Example: `if (remaining != null)` in `gsd-statusline.js`
- Default values used: `data.model?.display_name || 'Claude'`

## Logging & Output

**Framework:** None - uses native `process.stdout` and `process.stderr`

**Patterns:**
- Direct output via `process.stdout.write()` for status display
- Structured JSON output for cache files
- ANSI color codes for terminal display:
  ```javascript
  \x1b[32m  // Green
  \x1b[33m  // Yellow
  \x1b[38;5;208m  // Orange
  \x1b[5;31m  // Blinking red
  \x1b[0m   // Reset
  ```

## Node.js/Module Patterns

**Process Management:**
- `spawn()` for background processes (non-blocking)
- `unref()` to allow process to exit while child runs
- `stdio: 'ignore'` for background operations
- Example from `gsd-check-update.js`:
  ```javascript
  const child = spawn(process.execPath, ['-e', scriptCode], {
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  ```

**File System:**
- Synchronous fs operations (acceptable for hook/utility context)
- Defensive directory creation: `fs.mkdirSync(cacheDir, { recursive: true })`
- Path construction via `path.join()` for cross-platform compatibility

**Environment:**
- Home directory via `os.homedir()` (cross-platform)
- Current working directory via `process.cwd()`
- No environment variable dependencies

## Data Flow & State

**Input:**
- stdin JSON parsing in `gsd-statusline.js`
- File system reads for cached state
- No external API calls

**Output:**
- stdout for display (colored text)
- File system writes for cache persistence
- No stateful server responses

**State Management:**
- Disk-based caching (JSON files in `~/.claude/cache/`)
- No in-memory state between invocations
- Cache invalidation not implemented (persistent until manual cleanup)

## Cross-Cutting Concerns

**Paths & Filesystem:**
- All paths constructed with `path.join()` for cross-platform support
- Home directory detection via `os.homedir()` (Windows, macOS, Linux compatible)
- Recursive directory creation when needed

**Platform Compatibility:**
- Windows-specific flag: `windowsHide: true` in spawn options
- UTF-8 encoding explicitly specified
- Terminal escape codes used (works on any ANSI-compatible terminal)

**Security:**
- No hardcoded secrets or credentials
- JSON.stringify used for safe cache serialization
- File permissions: default system umask (no explicit mode setting)

## Configuration

**Locations:**
- `/.claude/settings.json` - Hook and permission configuration
- `/.claude/get-shit-done/templates/config.json` - GSD workflow settings

**No Linting/Formatting Tools Configured:**
- No `.eslintrc`
- No `.prettierrc`
- No `tsconfig.json`
- No `biome.json`

---

*Convention analysis: 2026-01-26*
