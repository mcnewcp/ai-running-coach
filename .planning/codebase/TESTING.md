# Testing Patterns

**Analysis Date:** 2026-01-26

## Project Scope

This codebase is a personal coaching project with minimal production code (2 utility scripts, 145 lines total):
- `/.claude/hooks/gsd-check-update.js` - GSD update checker
- `/.claude/hooks/gsd-statusline.js` - Status line display utility

**No testing infrastructure exists.** No test framework, test files, or testing configuration detected.

## Test Framework

**Status:** Not implemented

**Runner:** None detected
- No `jest.config.js`, `vitest.config.js`, `mocha.opts`, or other test configuration
- No test scripts in any `package.json` (no package.json exists)

**Assertion Library:** None

**Run Commands:** Not applicable

## Test File Organization

**Status:** No test files exist

**File Search Results:**
- No `*.test.js`, `*.spec.js` files found
- No `__tests__` directory
- No `tests/` directory

**Naming Convention:** Not established

## Testing Approach

**Current State:** Manual/Ad-hoc

The codebase relies on manual verification:
1. `gsd-check-update.js` - Tested by running in shell and checking `~/.claude/cache/gsd-update-check.json` output
2. `gsd-statusline.js` - Tested by piping JSON input and verifying stdout output

**Why No Tests:**
- Scripts are small utility hooks (61 lines, 84 lines respectively)
- Single responsibility: file I/O, JSON parsing, output formatting
- Low complexity; logic is straightforward
- Changes are infrequent (configuration hooks for Claude Code)

## Code Characteristics That Affect Testability

**Difficult to Test Without Refactoring:**
1. **Direct File System I/O:**
   ```javascript
   // Cannot easily mock fs module in current structure
   if (fs.existsSync(projectVersionFile)) {
     installed = fs.readFileSync(projectVersionFile, 'utf8').trim();
   }
   ```

2. **Direct Process Management:**
   ```javascript
   // spawn() creates actual child process
   const child = spawn(process.execPath, ['-e', scriptCode], {...});
   ```

3. **Direct stdin/stdout:**
   ```javascript
   // Reads from stdin, writes to stdout
   process.stdin.setEncoding('utf8');
   process.stdin.on('data', chunk => input += chunk);
   process.stdout.write(output);
   ```

4. **Inline String Injection:**
   ```javascript
   // JavaScript code as string (gsd-check-update.js)
   const child = spawn(process.execPath, ['-e', `
     const fs = require('fs');
     // ... code as string ...
   `]);
   ```

## How These Scripts Are Verified

**gsd-check-update.js:**
- Hook runs on Claude Code session start
- Checks for GSD package updates in background
- Output written to `~/.claude/cache/gsd-update-check.json`
- Verification: Manual check of cache file for `update_available` field

**gsd-statusline.js:**
- Hook runs periodically to update status line display
- Input: JSON from Claude Code runtime
- Output: Formatted string with ANSI colors to stdout
- Verification: Visual inspection of status line display in Claude Code

## If Testing Were to Be Implemented

### Recommended Approach

**Unit Testing Framework:** Node.js built-in `test` module or `node:assert`
- No external dependencies
- Built-in to Node 18+
- Sufficient for utility script testing

**Test Structure (if implemented):**
```javascript
// gsd-check-update.test.js
import assert from 'assert';
import { test } from 'node:test';

test('should detect when update is available', () => {
  // Mock fs module
  // Mock spawn() for version checks
  // Assert cache file contains correct update_available value
});

test('should handle missing VERSION files gracefully', () => {
  // Mock fs to return file not found
  // Assert default version '0.0.0' is used
});
```

**Test Data:**
- Mock VERSION files with known content
- Mock npm registry responses for version comparison
- Fixtures in `test/fixtures/` directory (if created)

### What Should Be Tested

**gsd-check-update.js:**
1. Version comparison logic (installed vs latest)
2. File existence checks for VERSION files
3. Cache file creation and format
4. Error handling for npm registry timeouts
5. Cross-platform path handling

**gsd-statusline.js:**
1. JSON parsing from stdin
2. Context window percentage calculations
3. Progress bar generation (filled/empty segments)
4. Color code selection based on usage thresholds
5. Task extraction from todos JSON
6. GSD update flag display
7. Output formatting with ANSI codes

### Mocking Strategy (If Implemented)

**fs module:**
```javascript
const mockFs = {
  existsSync: (path) => { /* return based on test case */ },
  readFileSync: (path) => { /* return test data */ },
  mkdirSync: () => {},
  readdirSync: () => []
};
```

**child_process.spawn:**
```javascript
const mockSpawn = () => ({
  unref: () => {}
});
```

**Environment:**
- Mock `os.homedir()` to return test directory
- Mock `process.cwd()` for predictable paths

## Coverage Considerations

**Current Coverage:** 0% - No tests exist

**If Tests Were Implemented:**
- Target: 80%+ for utility hooks (high value scripts)
- Skip coverage: Error handling in background processes (spawn), as these are non-critical paths
- Focus coverage on: Version parsing, JSON formatting, output generation

## Entry Points & Testing Concerns

**gsd-check-update.js:**
- Entry: Hook execution on `SessionStart`
- Dependencies: File system, npm registry (network), process spawning
- Async: Background spawn (fire-and-forget)
- Critical path: Version comparison and cache writing

**gsd-statusline.js:**
- Entry: Hook execution on status line render
- Dependencies: stdin/stdout, file system
- Async: stdin event-based processing
- Critical path: JSON parsing and output formatting

---

*Testing analysis: 2026-01-26*

**Summary:** This codebase contains no formal testing infrastructure. The utility scripts are simple hooks with direct I/O and would benefit from unit tests, but their small size and infrequent changes make manual verification acceptable for current maintenance level.
