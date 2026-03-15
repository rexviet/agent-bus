---
phase: 7
plan: 01
subsystem: worker CLI and daemon wiring
tags: [concurrency, worker-cli, verbose-monitor, logging, phase-7]

requires:
  - null

provides:
  - `--concurrency` and `--drain-timeout-ms` worker CLI flags with integer validation
  - `createMutex()` utility for serialized claim sections
  - Startup and shutdown output extended with concurrency and drained delivery counts
  - `verboseMonitorFactory` wiring from worker CLI through daemon startup into adapter execution
  - Delivery-scoped logger bindings with `workerId`

affects:
  - Phase 7 plan 02 slot-loop execution
  - Operator visibility for concurrent worker runs

tech-stack:
  added: []
  patterns:
    - Promise-chain mutex for async critical sections
    - Per-delivery verbose monitor construction keyed by `agentId`
    - Worker-scoped correlation IDs on structured daemon logs

key-files:
  created: []
  modified:
    - src/cli.ts
    - src/cli/output.ts
    - src/cli/worker-command.ts
    - src/daemon/adapter-worker.ts
    - src/daemon/index.ts

key-decisions:
  - "Expose `verboseMonitorFactory` separately from the legacy monitor so verbose output can bind real `agentId` values per delivery"
  - "Keep `--concurrency` default at 1 and `--drain-timeout-ms` default at 30000 to preserve pre-phase behavior"
  - "Add `workerId` to delivery child loggers instead of introducing separate worker lifecycle log events"

requirements-completed:
  - WORKER-01
  - WORKER-02

completed: 2026-03-15
---
<!-- AUTO-GENERATED from .planning/phases/07-concurrent-workers/07-01-SUMMARY.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 770be172994f108c61b23062752a75e46ce900514d7074b27621cea5dd84f7af. Edit the source file, not this projection. -->


# Phase 07 Plan 01: Worker Concurrency Controls Summary

**Added the CLI, output, monitor-factory, and logger wiring required to support concurrent worker slots without breaking the single-worker default path**

## Accomplishments

- Added `--concurrency` and `--drain-timeout-ms` parsing to `worker-command.ts`, including integer validation and defaults (`1` and `30000`)
- Exported `createMutex()` for serialized claim sections used by the concurrent slot loop
- Replaced the static `"agent"` verbose label with a delivery-scoped monitor factory that prints the actual `agentId`
- Extended worker startup output with `concurrency` and `drainTimeoutMs`
- Extended worker shutdown output with `drainedDeliveries`
- Threaded `verboseMonitorFactory` through `startDaemon()` into `createAdapterWorker()`
- Added `workerId` to delivery-scoped structured logs for slot-level correlation
- Updated top-level CLI help so the new worker flags are discoverable from `agent-bus --help`

## Files Modified

- `src/cli.ts` - added the new worker flags to top-level help text
- `src/cli/output.ts` - extended worker start/stop output and updated verbose line formatting to `[agentId] stdout|stderr`
- `src/cli/worker-command.ts` - added new flags, mutex export, and verbose monitor factory
- `src/daemon/index.ts` - forwarded `verboseMonitorFactory` and exposed in-flight drain hooks
- `src/daemon/adapter-worker.ts` - merged verbose monitors with timeout handling and bound `workerId` into child loggers

## Decisions Made

- **Preserve backward compatibility** - omitting `--concurrency` still produces the exact single-delivery execution model from pre-Phase-7 behavior
- **Factory, not singleton monitor** - concurrent workers need one verbose monitor per claimed delivery so stdout/stderr lines can show the real `agentId`
- **Correlation lives in existing delivery logs** - `workerId` is attached to the same NDJSON lifecycle events already emitted in Phase 6

## Test Results

```text
npm run build                                                     ✓
node --experimental-sqlite --test dist/test/cli/worker-command.test.js ✓ (10/10)
npm test                                                          ✓ (98/98)
```

Targeted assertions added in this plan's coverage:

- invalid `--concurrency` and `--drain-timeout-ms` values fail fast
- default `concurrency: 1` and `drainTimeoutMs: 30000` appear in worker output
- structured stderr logs now include `workerId`

## Ready for Plan 02

Plan 01 established every contract Plan 02 needed:

- claim serialization primitive (`createMutex`)
- concurrency/drain CLI configuration
- slot-aware log correlation via `workerId`
- per-delivery verbose monitor creation with real `agentId`
