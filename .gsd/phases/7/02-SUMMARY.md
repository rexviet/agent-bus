---
phase: 7
plan: 02
subsystem: concurrent worker execution
tags: [concurrency, drain, shutdown, lease-conflict, integration-tests, phase-7]

requires:
  - phase: 07-concurrent-workers
    plan: 01
    provides: CLI concurrency flags, mutex helper, verbose monitor wiring, workerId log bindings

provides:
  - Concurrent slot-loop execution with slot-scoped worker IDs
  - Graceful drain on SIGINT/SIGTERM with configurable timeout
  - SIGTERM -> 5s grace -> SIGKILL escalation for stuck in-flight agent process groups
  - Lease conflict warning logs at `warn` level with `event: lease.conflict`
  - Integration coverage for concurrency, sequential fallback, drain, drain timeout, and lease conflict handling

affects:
  - Runtime throughput under Phase 7
  - Shutdown behavior for long-running or stuck adapters
  - Delivery observability during concurrent claims

tech-stack:
  added: []
  patterns:
    - Slot-loop pool with serialized claim start
    - In-flight PID tracking inside adapter-worker
    - Drain timeout watcher with explicit timer cancellation

key-files:
  created: []
  modified:
    - src/cli/worker-command.ts
    - src/daemon/adapter-worker.ts
    - test/cli/worker-command.test.ts

key-decisions:
  - "Serialize the synchronous claim start by invoking `daemon.runWorkerIteration()` inside the mutex, then await the returned promise outside the critical section"
  - "Track in-flight delivery IDs separately from child PIDs so shutdown summaries count real deliveries, not just active slot loops"
  - "Keep drain timeout escalation in worker-command while reusing process-group kill semantics from Phase 5 via adapter-worker PID tracking"
  - "Use verbose drain tests to synchronize on actual child `onStart` before sending SIGTERM"

requirements-completed:
  - WORKER-01
  - WORKER-02
  - WORKER-03

completed: 2026-03-15
---
<!-- AUTO-GENERATED from .planning/phases/07-concurrent-workers/07-02-SUMMARY.md by scripts/sync-planning-to-gsd.mjs. source-sha256: fefb8b2298ad02ee0393505eded83a1592a8c00cce0ba913628c2793e001d18a. Edit the source file, not this projection. -->


# Phase 07 Plan 02: Concurrent Slot Loop Summary

**Replaced the sequential worker loop with concurrent slot execution, added clean shutdown drain semantics, and verified the phase with end-to-end CLI tests**

## Accomplishments

- Replaced the old single-loop worker implementation with slot workers named `worker-{id}/0`, `worker-{id}/1`, etc.
- Serialized delivery claim start with `claimMutex.run(...)` so only one slot enters the claim path at a time
- Preserved the default single-delivery behavior when `--concurrency` is omitted
- Added in-flight delivery and PID tracking in `adapter-worker.ts`
- Exposed `getInFlightDeliveryCount()` and `forceKillInFlight()` through `startDaemon()`
- Implemented graceful shutdown drain: on `SIGINT` / `SIGTERM`, stop claiming and wait for active deliveries to settle
- Implemented drain-timeout escalation: after `--drain-timeout-ms`, send `SIGTERM` to in-flight process groups and escalate to `SIGKILL` after 5 seconds
- Added explicit lease-conflict warning logging for failed claim races (`event: lease.conflict`)
- Expanded `test/cli/worker-command.test.ts` with end-to-end coverage for:
  - parallel execution with `--concurrency 2`
  - default sequential fallback
  - graceful drain on signal
  - drain-timeout force kill
  - lease-conflict warning path

## Files Modified

- `src/cli/worker-command.ts` - slot pool, stop/drain logic, timer cleanup, and error routing
- `src/daemon/adapter-worker.ts` - in-flight PID/delivery tracking, forced kill hook, conflict warning log, monitor merging
- `test/cli/worker-command.test.ts` - full Phase 7 behavior matrix

## Decisions Made

- **Drain timer cleanup matters** - the first implementation used `Promise.race()` directly and left the losing timeout alive; the final version clears the timer so a clean drain exits immediately
- **Always track child PIDs** - PID tracking now happens even without `--verbose` or per-agent timeout, otherwise forced drain escalation cannot reach stuck processes
- **Conflict warnings stay non-fatal** - a failed claim race logs a warning and returns `null` so the slot can continue polling instead of crashing the worker

## Test Results

```text
npm run build                                                     ✓
node --experimental-sqlite --test dist/test/cli/worker-command.test.js ✓ (10/10)
npm test                                                          ✓ (98/98)
```

Phase-7-specific runtime checks now prove:

- concurrent workers really start multiple deliveries in parallel
- default concurrency remains sequential
- shutdown drains in-flight work before exit
- stuck adapters are force-killed after the configured drain timeout plus the 5s grace window

## Phase Outcome

With Plan 02 complete, all three Phase 7 requirements are implemented and empirically verified. The runtime now supports concurrent delivery processing without regressing the single-worker path or abandoning in-flight work on shutdown.
