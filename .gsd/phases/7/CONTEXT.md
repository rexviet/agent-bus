<!-- AUTO-GENERATED from .planning/phases/07-concurrent-workers/07-CONTEXT.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 6912c3b16acdcb099870f5bad94a4cd9315e36c1c55400e1a3b16f72e317582e. Edit the source file, not this projection. -->

# Phase 7: Concurrent Workers - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable the daemon to process multiple deliveries in parallel via a `--concurrency N` CLI flag (default 1). The daemon drains all in-flight deliveries on shutdown before exiting. No per-agent concurrency limits, no dynamic scaling — static concurrency set at startup.

</domain>

<decisions>
## Implementation Decisions

### Shutdown drain behavior
- On SIGINT/SIGTERM, **stop claiming immediately** — no new deliveries are picked up
- Wait for all in-flight deliveries to complete, up to a **configurable drain timeout**
- New CLI flag: `--drain-timeout-ms N` (default 30000 — 30 seconds)
- When drain timeout expires: **SIGTERM → 5s grace → SIGKILL** (same escalation as Phase 5 timeout)
- Drained deliveries that were force-killed go to retry via existing recovery mechanism
- Worker stopped text includes **drain count** (e.g., "3 deliveries drained, 12 total processed")

### Verbose output with concurrency
- Each `--verbose` output line **prefixed with agent ID**: `[planner] stdout | processing file...`
- Agent ID only — no delivery ID in the prefix (delivery ID is in structured logs for deeper correlation)
- Worker **startup banner includes concurrency setting**: "Worker started: worker-1234, concurrency: 4, poll: 1000ms"
- Current static "agent" label replaced with actual agent ID per delivery (requires per-delivery monitor construction)

### SQLite contention
- **Serialize claims via mutex** — only one slot calls `claim()` at a time
- Before claiming, **check in-flight count < concurrency limit** — natural backpressure, no over-committing leases
- Acknowledge/fail operations are per-delivery and don't need serialization
- WAL mode handles concurrent reads naturally

### Worker identity
- **Shared base ID with slot suffix**: `worker-1234/0`, `worker-1234/1`, etc.
- Base worker ID from `--worker-id` flag (or default `worker-{pid}`), slot index appended
- Structured NDJSON logs include **`workerId` field** in each delivery log line for slot-level correlation
- Consistent with existing correlation fields (deliveryId, agentId, runId)

### Delivery exclusivity
- **Mutex on claim + lease check** — the serialized claim mutex prevents two slots from racing on the same delivery
- Lease token uniqueness at the DB level is the second guard (belt and suspenders)
- **Warn on lease conflict** — log at warn level if a conflict is detected: "Lease conflict detected for delivery X"
- One delivery is only ever processed by one worker slot at a time

### Claude's Discretion
- Worker pool implementation pattern (Promise.allSettled, worker loop per slot, semaphore, etc.)
- How the claim mutex is implemented (e.g., simple async lock, Mutex class)
- Where drain logic lives (worker-command.ts vs daemon index)
- How per-delivery monitors replace the current global monitor for verbose output

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createStopController()` (`worker-command.ts:85-113`): Already handles SIGINT/SIGTERM with stop promise. Needs extension for drain timeout but the pattern is solid.
- `ProcessMonitorCallbacks` (`process-runner.ts:34-45`): Per-delivery monitors already constructed in Phase 5 for timeout. Same pattern extends to per-delivery verbose monitors with agent ID prefix.
- `DaemonLogger.child()` (Phase 6): Per-delivery child loggers already created with deliveryId/agentId/runId. Adding workerId field is a one-line addition.
- `createAdapterWorker.runIteration()` (`adapter-worker.ts:327-613`): The core iteration function. Currently called sequentially; needs to be called concurrently from multiple slots.

### Established Patterns
- CLI flags follow `--kebab-case-ms` pattern for durations (`--lease-duration-ms`, `--poll-interval-ms`, `--retry-delay-ms`) — `--drain-timeout-ms` follows this pattern
- `parseIntegerAtLeast()` (`worker-command.ts:61-77`): Reusable for parsing `--concurrency` and `--drain-timeout-ms`
- `writeWorkerStartedText`/`writeWorkerStoppedText` (`output.ts`): Already structured output functions that accept config objects — extend with concurrency and drain count fields

### Integration Points
- `worker-command.ts` — Main file: add `--concurrency` and `--drain-timeout-ms` flags, replace sequential loop with concurrent worker pool, extend shutdown logic with drain timeout
- `adapter-worker.ts` — Per-delivery monitor construction (already done for timeout in Phase 5) extended to include verbose callbacks with agent ID
- `output.ts` — Extend `writeWorkerStartedText` params for concurrency, `writeWorkerStoppedText` for drain count, `writeAgentOutputLine` prefix with agent ID
- `daemon/logger.ts` — Add workerId to child logger bindings

</code_context>

<specifics>
## Specific Ideas

- The worker loop should transition from sequential (claim → run → sleep → repeat) to a concurrent pool where each slot independently claims and processes deliveries
- The claim mutex + in-flight count check acts as the concurrency governor: a slot only attempts to claim when the pool has capacity
- With concurrency 1 (default), behavior should be identical to current implementation — no observable change for existing users

</specifics>

<deferred>
## Deferred Ideas

- Per-agent concurrency limits (e.g., "max 2 planner agents at once") — future phase if needed
- Dynamic worker pool scaling based on queue depth — out of scope (REQUIREMENTS explicitly excludes this)
- Worker lifecycle structured log events (worker.started, worker.stopped, worker.idle) — noted as deferred in Phase 6

</deferred>

---

*Phase: 07-concurrent-workers*
*Context gathered: 2026-03-15*
