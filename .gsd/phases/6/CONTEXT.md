<!-- AUTO-GENERATED from .planning/phases/06-structured-logging/06-CONTEXT.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Phase 6: Structured Logging - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace unstructured text daemon output with NDJSON-formatted structured log lines on stderr. Operators can pipe stderr to `jq` or `grep` to filter and correlate daemon activity by deliveryId or agentId. Existing human-readable stdout output is preserved. Adding new CLI commands, modifying delivery state machine, or changing approval workflows is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Library choice
- Use **pino ^9.0.0** for structured NDJSON logging
- Verify ESM import resolves correctly with `"type": "module"` before implementation
- Use **numeric log levels** (pino defaults: 30=info, 40=warn, 50=error)
- **Single root logger** created in daemon startup (`createDaemonLogger()`), passed to services via options
- **Child loggers** created per-delivery with correlation fields (`deliveryId`, `agentId`, `runId`)
- Support **`--log-level` flag** on worker command (default: `info`). Accepts: debug/info/warn/error/fatal

### Output coexistence
- **Keep both**: human-readable text on stdout (existing `output.ts` functions unchanged), structured NDJSON on stderr
- No breaking change to existing operator workflows
- Operators use `2>daemon.log` to capture structured logs separately
- `--verbose` flag continues to work for human-readable agent output on stdout

### Lifecycle event scope
- **Core delivery events only** (what LOG-01 requires):
  - `delivery.claimed`
  - `agent.started`
  - `delivery.completed`
  - `delivery.retry_scheduled`
  - `delivery.dead_lettered`
- Worker lifecycle events (started/stopped/idle) and approval events are NOT in scope for Phase 6
- Those can be added in a future phase without changing the logging architecture

### Log level mapping
- `delivery.claimed` → info (30)
- `agent.started` → info (30)
- `delivery.completed` → info (30)
- `delivery.retry_scheduled` → info (30)
- `delivery.dead_lettered` → error (50)
- Normal flow is info; terminal failure (dead-letter) is error
- Retry is expected behavior, not a warning

### Claude's Discretion
- Where exactly `createDaemonLogger()` lives (likely `src/daemon/logger.ts`)
- How the logger is threaded through `startDaemon` options to `adapter-worker`
- Whether to add a `component` field to log lines (e.g., `"component": "adapter-worker"`)
- Exact pino configuration options (timestamp format, serializers, etc.)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProcessMonitorCallbacks` (`process-runner.ts:34-45`): Already has `onStart` and `onComplete` hooks — structured log calls can be added alongside existing callbacks
- `output.ts` (364 lines): Human-readable output functions — these stay on stdout, not replaced
- `WritableTextStream` interface (`output.ts:9-11`): Used by CLI for stdout/stderr separation — logger goes to stderr independently

### Established Patterns
- `monitor` object passed via `AdapterWorkerOptions` — logger can follow the same DI pattern
- `adapter-worker.ts` already has all delivery lifecycle transitions (claim, complete, fail, dead-letter) — log calls go at each transition point
- No existing logging library — this is greenfield; no migration needed

### Integration Points
- `src/daemon/adapter-worker.ts` — Main file: log at claim, start, complete, retry, dead-letter transitions
- `src/cli/worker-command.ts` — Parse `--log-level` flag, create logger, pass to daemon
- `src/daemon/start-daemon.ts` — Accept logger in startup options, thread to services
- `package.json` — Add `pino` dependency

</code_context>

<specifics>
## Specific Ideas

- Each structured log line must include: `deliveryId`, `agentId`, `runId`, `level`, `timestamp` (LOG-02 requirement)
- Operator one-liner filter example: `agent-bus worker 2>&1 >/dev/null | jq 'select(.agentId == "planner")'`
- Child logger pattern: create once per delivery iteration with correlation fields, use for all events in that delivery's lifecycle

</specifics>

<deferred>
## Deferred Ideas

- Worker lifecycle events (worker.started, worker.stopped, worker.idle) — future phase
- Approval events (approval.requested, approval.decided) — future phase
- Timeout discrimination in dead-letter exit reason — deferred to v2 (LOG-04)
- pino-pretty as dev dependency for human-readable dev mode — nice-to-have, not required

</deferred>

---

*Phase: 06-structured-logging*
*Context gathered: 2026-03-14*
