# Agent Bus — Retrospective

---

## Milestone: v1.1 — Production Hardening

**Shipped:** 2026-03-16
**Phases:** 4 (5–8) | **Plans:** 9 | **Timeline:** 2 days (2026-03-14 → 2026-03-16)
**Tests:** 116/116 | **Files changed:** 144 | **~13,600 LOC TypeScript**

### What Was Built

- Per-agent `timeout` in manifest → SIGTERM to process group → SIGKILL after 5s grace → delivery retry (not dead-letter)
- pino NDJSON lifecycle logs on stderr, correlated by deliveryId/agentId/runId/workerId, filterable by jq/grep
- `--concurrency N` worker slots with mutex-serialized claiming, graceful drain on shutdown, force-kill on drain timeout
- Embedded MCP HTTP server: agents receive `AGENT_BUS_MCP_URL`, call `publish_event` tool during execution

### What Worked

- **Dependency chain discipline**: each phase explicitly listed what it required from prior phases — zero integration surprises at Phase 8
- **Optional injection pattern**: logger and MCP URL injected optionally at each layer — backward compatibility maintained throughout without feature flags
- **Per-delivery child loggers**: binding correlation fields at claim time (after event fetch for runId) made log correlation trivial and required zero rework
- **Process-group kill reuse**: Phase 5's `process.kill(-pid)` semantics were reused directly by Phase 7's drain timeout escalation — no duplication needed
- **TDD on lifecycle tests**: mock logger + recorded calls approach in adapter-worker tests gave precise coverage of all 5 lifecycle events across 4 execution paths

### What Was Inefficient

- **05-02-SUMMARY.md frontmatter**: TIMEOUT-02/TIMEOUT-03 landed in `dependency_graph.requires` instead of `requirements-completed` — administrative friction during audit
- **VALIDATION.md draft status**: phases 5, 6, 8 shipped with `status: draft` VALIDATION.md files — required a separate `/gsd:validate-phase` pass at audit time
- **`--mcp-port 0` oversight**: CLI validator minimum of 1 blocks explicit ephemeral port request — caught at integration check, not during planning

### Patterns Established

- Optional injection pattern: `readonly field?: Type` at every layer boundary, spread at call site — enables backward compat without feature flags
- Per-delivery child logger after event fetch: `logger?.child({ deliveryId, agentId, runId: event.runId, workerId })` — runId lives on event record not delivery
- Mutex-serialized claim start: `claimMutex.run(() => daemon.runWorkerIteration())` — prevents double-claim in concurrent slots
- MCP server lifecycle: start before adapter worker, stop in daemon shutdown after drain, expose URL through daemon object

### Key Lessons

- Validate `--mcp-port` minimum as 0, not 1: port 0 is the standard OS ephemeral binding mechanism
- Mark VALIDATION.md `status: approved` (not `draft`) immediately at execution time — avoids a separate validate-phase sweep at audit
- SUMMARY frontmatter `requirements-completed` should list the requirements the plan *delivers*, not what it *depends on*

### Cost Observations

- Sessions: ~8 across 2 days
- Notable: phases 6 and 7 completed same day (2026-03-15) — well-scoped plans with clear interfaces enabled rapid sequential execution

---

## Cross-Milestone Trends

| Milestone | Duration | Tests at Ship | Phases | Plans | Key Pattern |
|-----------|----------|---------------|--------|-------|-------------|
| v1.0 Core Runtime | ~10 days | 66/66 | 4 | 8 | Event/delivery/storage foundation |
| v1.1 Production Hardening | 2 days | 116/116 | 4 | 9 | Optional injection + process-group kill |
