---
phase: 05-foundation-safety
plan: 03
subsystem: Process timeout and graceful shutdown
tags: [timeout, adapter-worker, per-delivery-monitor, SIGTERM-SIGKILL, process-management]

requires:
  - phase: 05-foundation-safety
    plan: 01
    provides: Optional timeout field (seconds) in agent manifest schema
  - phase: 05-foundation-safety
    plan: 02
    provides: SIGTERM → SIGKILL escalation with 5000ms grace period, result file deletion

provides:
  - Per-delivery ProcessMonitorCallbacks built from agent.timeout
  - Timeout routing through deliveryService.fail() for retry (not dead-letter)
  - Integration test confirming timed-out deliveries retry correctly
  - Backward-compatibility: agents without timeout field have no timeout applied

affects:
  - Future phases relying on timeout-based delivery retry behavior
  - Operator configurations using agent.timeout in manifest

tech-stack:
  added: []
  patterns:
    - Per-delivery monitor construction from agent configuration
    - Seconds-to-milliseconds conversion at daemon layer
    - Signal-exit routing through existing retry mechanism

key-files:
  created: []
  modified:
    - src/daemon/adapter-worker.ts
    - test/daemon/adapter-worker.test.ts

key-decisions:
  - "Per-delivery monitor built inside runIteration after agent is resolved"
  - "Agent without timeout field uses global options.monitor (backward-compatible)"
  - "Timeout signal exits route through deliveryService.fail() — no special dead-letter logic needed"
  - "Test uses monitor-fixture.mjs with FIXTURE_DELAY_MS=5000 (5s delay) and agent.timeout=1 (1s)"

patterns-established:
  - "When agent.timeout !== undefined, construct monitor: { ...(options.monitor ?? {}), timeoutMs: agent.timeout * 1000 }"
  - "Agents without timeout field inherit global monitor (if any) without timeout behavior"

requirements-completed:
  - TIMEOUT-04

duration: 6min
completed: 2026-03-14
---

# Phase 05 Plan 03: Per-Delivery Timeout Wiring Summary

**Per-delivery monitor constructed from agent.timeout in adapter-worker; timed-out deliveries scheduled for retry with integration test confirming no regressions**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-14T09:52:10Z
- **Completed:** 2026-03-14T10:00:15Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Per-delivery `ProcessMonitorCallbacks` now constructed inside `runIteration` from `agent.timeout * 1000`
- Agents without `timeout` field fall back to global `options.monitor` (backward-compatible, no timeout applied)
- Timed-out deliveries (SIGKILL signal exit) correctly routed to `deliveryService.fail()` for retry (not dead-lettered)
- Integration test verifies timeout-retry: agent with `timeout: 1` (1 second) runs task sleeping 5 seconds → timeout triggers → delivery status = "retry_scheduled"
- No-timeout regression test confirms agents without timeout configured complete successfully
- All 82 tests pass (6 adapter-worker tests including 2 new timeout tests)
- Full test suite runs without regression: process-runner tests, manifest tests, storage tests all pass

## Task Commits

1. **Task 1: Wire per-delivery monitor from agent.timeout; add timeout-retry integration test** - `4f0167f` (feat)

## Files Created/Modified

- `src/daemon/adapter-worker.ts` - Per-delivery monitor construction at lines 360-364; monitor passed to runPreparedAdapterCommand at line 401
- `test/daemon/adapter-worker.test.ts` - Added monitorFixturePath constant (line 18); added timeout-retry test (lines 375-435); added no-timeout regression test (lines 437-496)

## Decisions Made

- **Per-delivery monitor constructed inside runIteration** — Agent is resolved (line 359), so timeout value is available. Construct monitor before workPackage creation.
- **Preserve global monitor callbacks** — Spread existing `options.monitor` to preserve any stdout/stderr/onStart/onComplete callbacks configured globally.
- **Test timing: 1s timeout, 5s delay** — FIXTURE_DELAY_MS=5000 causes the fixture to sleep, timeout fires at 1000ms, SIGKILL escalates after 5000ms grace. Total elapsed ~6s. Acceptable per plan validation criteria.
- **Two separate tests** — One confirms timeout → retry_scheduled; second confirms no regression for agents without timeout (complete successfully).

## Deviations from Plan

None - plan executed exactly as written.

All requirements met:
- [TIMEOUT-04] Agent timeout wired from manifest into per-delivery monitor construction
- Timed-out delivery scheduled for retry (via deliveryService.fail() existing retry path)
- Result file already deleted by Plan 02 (process-runner.ts SIGKILL handler)
- Full integration with Plans 01 and 02

## Issues Encountered

None - TDD RED → GREEN flow completed cleanly without blocking issues.

## Test Results

```
npm run build    ✓ (TypeScript compiled successfully)
npm run typecheck ✓ (No type errors)
npm test         ✓ (82 tests pass)

Adapter-worker specific:
- ok 1: runWorkerIteration executes a successful adapter and republishes emitted events
- ok 2: runWorkerIteration schedules retryable adapter failures
- ok 3: runWorkerIteration dead-letters fatal adapter failures immediately
- ok 4: runWorkerIteration rolls back emitted events when the worker lease expires
- ok 5: runWorkerIteration schedules retry when agent times out  ← NEW
- ok 6: runWorkerIteration completes successfully when agent has no timeout configured ← NEW
```

All previous tests (77-82: run/event stores, delivery store, storage) pass unchanged.

## Verification Checklist

- `grep "agent\.timeout \* 1000" src/daemon/adapter-worker.ts` — confirms seconds-to-ms conversion present
- `grep "perDeliveryMonitor" src/daemon/adapter-worker.ts` — confirms per-delivery monitor construction
- `npm run typecheck` — no TypeScript errors
- `node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` — timeout-retry test passes
- `npm test` — full suite green (82/82)

## Next Phase Readiness

All four TIMEOUT requirements (TIMEOUT-01 through TIMEOUT-04) satisfied across Plans 01–03:

- **TIMEOUT-01 (Plan 01):** Agent manifest schema has optional `timeout: number` (seconds)
- **TIMEOUT-02 (Plan 02):** Process group kill via `process.kill(-pid, "SIGTERM")`
- **TIMEOUT-03 (Plan 02):** SIGKILL escalation after 5000ms grace period
- **TIMEOUT-04 (Plan 03):** Per-delivery monitor wired from manifest; timeout-retry integrated

Foundation Safety phase complete. Ready for Phase 6 (logging + daemon harness).

---

*Phase: 05-foundation-safety*
*Completed: 2026-03-14*
