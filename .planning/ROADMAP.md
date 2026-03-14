# Roadmap: Agent Bus

## Milestones

- ✅ **v1.0 Core Runtime** — Phases 1-4 (shipped 2026-03-10)
- 🚧 **v1.1 Production Hardening** — Phases 5-8 (in progress)
- ○ **v1.2 Developer Experience** — SDK/library mode, event schema registry, web dashboard, plugin system for adapters
- ○ **v1.3 Scale & Ecosystem** — PostgreSQL backend option, distributed worker support, adapter marketplace, multi-repo orchestration

## Phases

<details>
<summary>✅ v1.0 Core Runtime (Phases 1-4) — SHIPPED 2026-03-10</summary>

Phases 1-4 delivered the core event-driven orchestration runtime: manifest-driven configuration, SQLite-backed durable delivery, approval gates, retry/dead-letter/replay, runtime adapters (Codex, Gemini CLI, Open Code), and CLI operator tooling. 66/66 tests passing at ship.

</details>

### 🚧 v1.1 Production Hardening (In Progress)

**Milestone Goal:** Harden the runtime for real-world unattended use — agents cannot hang indefinitely, daemon secrets do not leak, delivery processing scales to concurrent work, and agents can publish follow-up events directly via an embedded MCP server.

## Phase Details

### Phase 5: Foundation Safety
**Goal**: Operators can configure per-agent process timeouts and the daemon reliably terminates hung agent process trees
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: TIMEOUT-01, TIMEOUT-02, TIMEOUT-03, TIMEOUT-04
**Success Criteria** (what must be TRUE):
  1. Operator sets `timeout` field in agent manifest and the daemon honors it — processes running past the limit are killed
  2. Sending SIGTERM kills the entire agent process group (not just the direct child), so shell wrappers and grandchild processes are terminated
  3. After SIGTERM, the daemon escalates to SIGKILL if the process group does not exit within the configured grace period
  4. A timed-out delivery is rescheduled for retry rather than immediately moved to the dead-letter queue
**Plans**: TBD

### Phase 6: Structured Logging
**Goal**: Operators can filter and correlate daemon log output by delivery or agent without additional tooling
**Depends on**: Phase 5
**Requirements**: LOG-01, LOG-02, LOG-03
**Success Criteria** (what must be TRUE):
  1. Daemon writes NDJSON-formatted log lines to stderr for every delivery lifecycle event (claim, start, complete, retry, dead-letter)
  2. Every log line includes `deliveryId`, `agentId`, `runId`, `level`, and `timestamp` fields
  3. Operator can pipe daemon stderr to `jq` or `grep` and filter to a single delivery or agent with a one-liner
**Plans**: TBD

### Phase 7: Concurrent Workers
**Goal**: Operators can run multiple deliveries in parallel and the daemon drains cleanly on shutdown
**Depends on**: Phase 6
**Requirements**: WORKER-01, WORKER-02, WORKER-03
**Success Criteria** (what must be TRUE):
  1. Operator starts daemon with `--concurrency N` and up to N agent processes run simultaneously
  2. Daemon started without `--concurrency` flag defaults to concurrency 1, preserving existing single-delivery behavior
  3. On receiving a stop signal, the daemon completes all in-flight deliveries before exiting — no deliveries are abandoned mid-execution
**Plans**: TBD

### Phase 8: Embedded MCP Server
**Goal**: Agents can publish follow-up events directly during execution by calling the MCP `publish_event` tool
**Depends on**: Phase 7
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04
**Success Criteria** (what must be TRUE):
  1. Daemon starts an MCP HTTP server on localhost when it starts; server is accessible without any additional setup by the operator
  2. Agent receives `AGENT_BUS_MCP_URL` env var in its work package and can use it to reach the MCP server
  3. Agent can call the `publish_event` MCP tool during execution and the event appears in the event store immediately
  4. An agent identity file that calls `publish_event` via MCP successfully publishes follow-up events without writing an `events` array in the result envelope
**Plans**: TBD

## Progress

**Execution Order:** 5 → 6 → 7 → 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Foundation Safety | v1.1 | 0/? | Not started | - |
| 6. Structured Logging | v1.1 | 0/? | Not started | - |
| 7. Concurrent Workers | v1.1 | 0/? | Not started | - |
| 8. Embedded MCP Server | v1.1 | 0/? | Not started | - |
