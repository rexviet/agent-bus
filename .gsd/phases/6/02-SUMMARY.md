---
phase: 6
plan: 02
subsystem: worker CLI logging
tags: [structured-logging, worker-command, stderr, ndjson, log-level]

requires:
  - phase: 6
    plan: 01
    provides: Daemon logger factory and lifecycle log emission

provides:
  - `--log-level` flag on `agent-bus worker`
  - Default `info`-level daemon logger creation for worker executions
  - Real stderr NDJSON output that is parseable by `JSON.parse`, `grep`, and `jq`
  - Clear validation errors for invalid or missing `--log-level` values

affects:
  - Operator experience when running `agent-bus worker`
  - Runtime troubleshooting by delivery or agent correlation

tech-stack:
  added: []
  patterns:
    - CLI-level validation against a fixed log-level enum
    - Logger destination bound to command `io.stderr`
    - Parse stderr NDJSON in tests instead of mocking logger calls

key-files:
  created: []
  modified:
    - src/cli/worker-command.ts
    - src/cli.ts
    - test/cli/worker-command.test.ts

key-decisions:
  - "Always create a daemon logger in `worker-command`; omitted `--log-level` defaults to `info`"
  - "Pass `io.stderr` as the logger destination so CLI tests and real terminal stderr share the same behavior"
  - "Validate log level before daemon startup and exit with code 1 on invalid input"

requirements-completed:
  - LOG-03

duration: 1min
completed: 2026-03-15
---

# Phase 6 Plan 02: Worker Log-Level CLI Summary

**Added `--log-level` to the worker command, bound daemon logs to stderr, and verified that operators can parse and filter NDJSON output directly**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-15T11:30:27+07:00
- **Completed:** 2026-03-15T11:31:44+07:00
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Added `--log-level` to `agent-bus worker`
- Accepted log levels: `debug`, `info`, `warn`, `error`, `fatal`
- Defaulted logging to `info` when `--log-level` is omitted
- Rejected invalid or missing `--log-level` values with clear CLI errors and exit code `1`
- Created the worker's daemon logger with `io.stderr` as the destination, so stderr carries structured NDJSON lifecycle logs in real CLI usage
- Verified in tests that stderr log lines parse as JSON and include the required fields

## Task Commits

1. **Task 1: Add --log-level flag to worker command and wire logger to daemon** - `7fc3788` (feat)

## Files Created/Modified

- `src/cli/worker-command.ts` - Added `--log-level` parsing, validation, defaulting, and logger creation
- `src/cli.ts` - Updated top-level help text for worker usage
- `test/cli/worker-command.test.ts` - Added invalid/missing value coverage plus stderr NDJSON parsing tests

## Decisions Made

- **Worker always passes a logger** - structured logging becomes the default operator experience for the worker command
- **Destination is CLI stderr, not hard-coded fd 2** - runtime behavior still targets stderr, but remains testable through injected command IO
- **Validation stays in the CLI layer** - invalid log-level input is rejected before daemon startup

## Deviations from Plan

None. The CLI-facing scope stayed exactly within the planned work.

## Test Results

```text
npm run typecheck                                                     ✓
npm run build                                                         ✓
node --experimental-sqlite --test dist/test/cli/worker-command.test.js ✓ (5/5)
npm test                                                              ✓ (91/91)
```

The worker-command suite now verifies:

- successful `--log-level debug`
- default `info` behavior when omitted
- invalid log-level rejection
- missing log-level value rejection
- parseable NDJSON on stderr with correlation fields

## Next Phase Readiness

Phase 6 is complete on the execution side:

- daemon lifecycle logs are structured and correlated
- worker CLI exposes log-level control
- stderr output is filterable without extra tooling beyond `grep` or `jq`

Next execution milestone is Phase 7, after planning and sync are prepared.
