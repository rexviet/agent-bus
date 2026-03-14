# Requirements: Agent Bus

**Defined:** 2026-03-14
**Core Value:** Enable asynchronous, event-driven coordination between multiple agent runtimes inside one repository on one machine with durable orchestration primitives and human-in-the-loop approval gates.

## v1.1 Requirements

Requirements for Production Hardening milestone. Each maps to roadmap phases.

### Timeout

- [x] **TIMEOUT-01**: Operator can configure per-agent process timeout via `timeout` field in agent manifest ✓ COMPLETE (Plan 05-01)
- [x] **TIMEOUT-02**: Daemon sends SIGTERM to the agent process group (not just direct child) when timeout expires ✓ COMPLETE (Plan 05-02)
- [x] **TIMEOUT-03**: Daemon escalates to SIGKILL if agent process group does not exit within a grace period after SIGTERM ✓ COMPLETE (Plan 05-02)
- [x] **TIMEOUT-04**: Timed-out delivery is scheduled for retry rather than immediately dead-lettered ✓ COMPLETE (Plan 05-03)

### Logging

- [ ] **LOG-01**: Daemon writes structured NDJSON log lines to stderr for all delivery lifecycle events
- [ ] **LOG-02**: Each log line includes correlation fields: `deliveryId`, `agentId`, `runId`, `level`, `timestamp`
- [ ] **LOG-03**: Operator can pipe daemon stderr to `jq`/`grep` to filter by deliveryId or agentId without additional tooling

### Workers

- [ ] **WORKER-01**: Operator can start daemon with `--concurrency N` flag to run up to N deliveries in parallel
- [ ] **WORKER-02**: Daemon defaults to concurrency 1, preserving backward-compatible behavior
- [ ] **WORKER-03**: Daemon drains all in-flight deliveries to completion before shutting down

### MCP Server

- [ ] **MCP-01**: Daemon starts an embedded MCP HTTP server on localhost when the daemon starts
- [ ] **MCP-02**: Agent receives `AGENT_BUS_MCP_URL` env var in work package pointing to the MCP server
- [ ] **MCP-03**: Agent can call `publish_event` MCP tool to publish follow-up events during execution
- [ ] **MCP-04**: Agent identity file can use `publish_event` MCP tool instead of writing `events` in the result envelope

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Foundation Safety

- **ENVISO-01**: Operator can configure per-agent env isolation via `envMode: inherit|isolated` in manifest
- **ENVISO-02**: Daemon validates at startup that leaseDurationMs > timeoutMs + graceMs to prevent double-execution

### MCP Server (extended)

- **MCP-05**: Agent can call `get_delivery` MCP tool to fetch its own delivery context during execution
- **MCP-06**: Agent can call `list_artifacts` MCP tool to enumerate available workspace artifacts

### Observability

- **LOG-04**: Timed-out delivery is distinguishable from crash in dead-letter queue (separate exit reason field)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web dashboard | Stated out of scope for v1.x; CLI-first approach |
| Multi-machine orchestration | v1.x is local-first by design |
| MCP authentication | Localhost-only; no network exposure in v1.1 |
| Dynamic worker pool scaling | Static `--concurrency N` at startup is sufficient |
| `events` array deprecation in result envelope | Keep backward-compat in v1.1; deprecate in v1.2 after MCP adoption |
| Log aggregation (CloudWatch, Loki) | Local-first tool; NDJSON to stderr is operator-greppable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TIMEOUT-01 | Phase 5 | Complete (2026-03-14) |
| TIMEOUT-02 | Phase 5 | Complete (2026-03-14) |
| TIMEOUT-03 | Phase 5 | Complete (2026-03-14) |
| TIMEOUT-04 | Phase 5 | Complete (2026-03-14) |
| LOG-01 | Phase 6 | Pending |
| LOG-02 | Phase 6 | Pending |
| LOG-03 | Phase 6 | Pending |
| WORKER-01 | Phase 7 | Pending |
| WORKER-02 | Phase 7 | Pending |
| WORKER-03 | Phase 7 | Pending |
| MCP-01 | Phase 8 | Pending |
| MCP-02 | Phase 8 | Pending |
| MCP-03 | Phase 8 | Pending |
| MCP-04 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after roadmap creation (v1.1 phases 5-8)*
