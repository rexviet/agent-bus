# Phase 5: Foundation Safety - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire process timeout configuration through the manifest into the daemon. Operators can configure per-agent timeouts in YAML; the daemon terminates hung agent process trees via SIGTERM → SIGKILL, then retries the delivery. Creating, updating, or removing any other manifest fields is out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Timeout field in manifest

- Field name: `timeout` (not `timeoutMs`, not `processTimeout`)
- Unit: **seconds** in the YAML manifest — e.g., `timeout: 30`. Internally converted to ms when passed to `ProcessMonitorCallbacks.timeoutMs`.
- Location: on the `agent` object in the manifest — `agents: [{id: planner, timeout: 300, ...}]`
- Optional: no default. Agents without a `timeout` field run until they exit or the daemon stops. Backward-compatible.
- No global workspace-level default timeout (deferred to future milestone if needed).

### Grace period (SIGTERM → SIGKILL)

- Fixed **5 seconds** between SIGTERM and SIGKILL — not configurable per-agent in v1.1.
- Process group kill required: use `process.kill(-child.pid, "SIGTERM")` and `process.kill(-child.pid, "SIGKILL")` to terminate shell wrappers and grandchild processes, not just the direct child.
- After SIGKILL, **delete the partial result file** before the retry attempt can run. Prevents a timed-out agent's partial write from being parsed as a valid result.

### Retry behavior after timeout

- Retry delay: same `retryDelayMs` as regular failure (default 30s). No timeout-specific delay.
- Timeout **counts as a regular retry attempt** toward max retries. An agent that consistently times out will eventually be dead-lettered.
- Delivery is scheduled for retry (not dead-lettered) on timeout — unless max retries are exhausted.

### Claude's Discretion

- Where exactly in `process-runner.ts` / `adapter-worker.ts` the timeout detection logic is refactored
- How `timeoutMs` is propagated from manifest agent → `ProcessMonitorCallbacks` (likely via `adapter-worker.ts` reading `agent.timeout * 1000`)
- Spawn options for detached process group (`detached: true` + `unref()` pattern, or `process.kill(-pid)` from parent)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `ProcessMonitorCallbacks.timeoutMs` (`process-runner.ts:44`): The timeout hook already exists — it sets a `setTimeout` that calls `child.kill("SIGTERM")`. Gap: kills only direct child; no SIGKILL escalation; not wired from manifest.
- `AgentSchema` (`manifest-schema.ts:49`): The Zod schema where `timeout` field needs to be added as `z.number().positive().optional()`.
- `AdapterWorkerOptions.monitor` (`adapter-worker.ts:86`): Currently a single global `ProcessMonitorCallbacks` passed to all iterations. Per-agent timeout requires reading `agent.timeout` inside `runIteration` and constructing per-delivery monitor callbacks.

### Established Patterns

- All manifest durations use milliseconds internally (`leaseDurationMs`, `retryDelayMs`) — conversion from seconds (YAML) to ms (internal) is a new pattern for this field only.
- Zod schema uses `.optional()` for optional agent fields (see `identityFile`, `description`, `workingDirectory`) — follow same pattern for `timeout`.
- `finalizeLeaseBoundTransition` handles the retry/dead-letter decision in `adapter-worker.ts` — timeout should route through the existing `.fail()` path (not `.deadLetter()`).

### Integration Points

- `manifest-schema.ts` → add `timeout: z.number().positive().optional()` to `AgentSchema`
- `process-runner.ts` → replace `child.kill("SIGTERM")` with `process.kill(-child.pid, "SIGTERM")`; add SIGKILL escalation after 5s; delete result file after kill
- `adapter-worker.ts` → inside `runIteration`, read `agent.timeout` and build per-delivery `ProcessMonitorCallbacks` with `timeoutMs: agent.timeout * 1000`; route timeout signal exit through `.fail()` for retry

</code_context>

<specifics>
## Specific Ideas

- Spawn with `detached: true` so child gets its own process group — required for `process.kill(-child.pid, ...)` to work
- The result file cleanup on timeout should happen inside `runPreparedAdapterCommand` after the SIGKILL resolves, before returning `AdapterProcessRunResult`

</specifics>

<deferred>
## Deferred Ideas

- Global workspace-level `defaultTimeout` — future milestone if operators want a fallback
- `envMode: inherit|isolated` per-agent — deferred to v2 (ENVISO-01)
- Startup validation that `leaseDurationMs > timeoutMs + graceMs` — deferred to v2 (ENVISO-02)
- Timeout discrimination in dead-letter (separate exit reason) — deferred to v2 (LOG-04)

</deferred>

---

*Phase: 05-foundation-safety*
*Context gathered: 2026-03-14*
