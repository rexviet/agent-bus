---
phase: quick-monitoring
plan: 01
subsystem: adapters
tags: [process-monitoring, streaming, timeout, cli, worker]

requires: []
provides:
  - ProcessMonitorCallbacks interface on process-runner with stdout/stderr streaming, lifecycle events, and timeout enforcement
  - "--verbose flag on worker command for realtime agent output in terminal"
  - writeAgentOutputLine, writeAgentStartedText, writeAgentCompletedText output helpers
affects: [future adapter integrations, worker command evolution]

tech-stack:
  added: []
  patterns:
    - "Opt-in monitoring via optional monitor field - zero impact when not provided"
    - "Dual-write pattern: on('data') callbacks write to both logStream and monitor callbacks"
    - "Line buffering partial chunks in CLI using closure-based state"

key-files:
  created:
    - test/adapters/process-runner-monitor.test.ts
    - test/fixtures/adapters/monitor-fixture.mjs
  modified:
    - src/adapters/process-runner.ts
    - src/cli/output.ts
    - src/cli/worker-command.ts
    - src/daemon/adapter-worker.ts
    - src/daemon/index.ts

key-decisions:
  - "Use on('data') instead of pipe() when monitor provided, to support dual-write to callback and logStream"
  - "Pass monitor through AdapterWorkerOptions and StartDaemonOptions rather than per-iteration to keep iteration signatures clean"
  - "Use static 'agent' label in verbose output (not per-delivery agentId) since monitor is created once at daemon start"

requirements-completed: [MON-01, MON-02, MON-03, MON-04]

duration: 6min
completed: 2026-03-13
---

# Quick Task 1: Agent Process Monitoring Summary

**Process monitoring with opt-in stdout/stderr streaming, lifecycle events (onStart/onComplete), SIGTERM timeout enforcement, and --verbose CLI flag for realtime operator visibility**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-13T14:15:03Z
- **Completed:** 2026-03-13T14:20:44Z
- **Tasks:** 2 of 2 (checkpoint awaiting human verification)
- **Files modified:** 5 source files + 2 test files

## Accomplishments
- Added `ProcessMonitorCallbacks` interface with onStdout, onStderr, onStart, onComplete, timeoutMs fields
- Implemented dual-write in `runPreparedAdapterCommand`: when monitor provided, `on("data")` handlers write to both logStream AND callbacks; when absent, existing `pipe()` behavior unchanged
- Added SIGTERM timeout enforcement via `setTimeout`/`clearTimeout` around child process
- Threaded monitor option through `AdapterWorkerOptions` → `StartDaemonOptions` → `createAdapterWorker` → `runPreparedAdapterCommand`
- Added `--verbose` flag to worker command that builds line-buffered `ProcessMonitorCallbacks` streaming to terminal
- Added 3 output helpers to `output.ts`: `writeAgentOutputLine`, `writeAgentStartedText`, `writeAgentCompletedText`
- 7 TDD tests covering all behaviors; 73 total tests pass (no regressions)

## Task Commits

1. **Task 1: Add process monitoring to process-runner with timeout support** - `2f50e98` (feat)
2. **Task 2: Add CLI output helpers and wire monitoring into worker-command** - `d1cf4d2` (feat)

## Files Created/Modified
- `src/adapters/process-runner.ts` - Added ProcessMonitorCallbacks interface and optional monitor field; switched to dual-write on("data") pattern when monitor present
- `src/cli/output.ts` - Added writeAgentOutputLine, writeAgentStartedText, writeAgentCompletedText helpers
- `src/cli/worker-command.ts` - Added --verbose flag; builds line-buffered monitor callbacks when set
- `src/daemon/adapter-worker.ts` - Added optional monitor field to AdapterWorkerOptions; threads to runPreparedAdapterCommand
- `src/daemon/index.ts` - Added optional monitor field to StartDaemonOptions; threads to createAdapterWorker
- `test/adapters/process-runner-monitor.test.ts` - 7 TDD tests for monitoring behaviors
- `test/fixtures/adapters/monitor-fixture.mjs` - Subprocess fixture controlled via env vars (stdout lines, stderr lines, delay, exit code)

## Decisions Made
- `on("data")` instead of `.pipe()` when monitor is provided: pipe doesn't expose chunks for callbacks; `on("data")` allows writing to both destinations without breaking logStream semantics
- Monitor threaded through `AdapterWorkerOptions`/`StartDaemonOptions` (not per-iteration): cleaner API since monitor is typically constant for a worker session
- `"agent"` as static label in verbose output: monitor is created once at daemon start before any delivery is claimed; per-delivery agentId would require restructuring the monitor lifecycle

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- Initial test fixture path resolution used `import.meta.url` which produced a path in `dist/test/` that doesn't exist. Fixed by using `process.cwd()` + relative path (same pattern as all other tests in the project).

## Next Phase Readiness
- Agent monitoring is fully operational; operators can use `agent-bus worker --verbose` to see realtime agent output
- Timeout enforcement available via `timeoutMs` in ProcessMonitorCallbacks but not yet exposed as a CLI option (potential follow-up)
- Log files still capture all output regardless of --verbose setting

## Self-Check: PASSED

---
*Phase: quick-monitoring*
*Completed: 2026-03-13*
