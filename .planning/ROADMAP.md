# Roadmap: Agent Bus

## Milestones

- ✅ **v1.0 Core Runtime** — Phases 1-4 (shipped 2026-03-10)
- ✅ **v1.1 Production Hardening** — Phases 5-8 (shipped 2026-03-16)
- 🚧 **v1.2 Developer Experience** — Phases 9-11 (in progress)
- 📋 **v1.3 Scale & Ecosystem** — SDK/library mode, plugin adapter system, PostgreSQL backend option, distributed worker support, adapter marketplace, multi-repo orchestration

## Phases

<details>
<summary>✅ v1.0 Core Runtime (Phases 1-4) — SHIPPED 2026-03-10</summary>

Phases 1-4 delivered the core event-driven orchestration runtime: manifest-driven configuration, SQLite-backed durable delivery, approval gates, retry/dead-letter/replay, runtime adapters (Codex, Gemini CLI, Open Code), and CLI operator tooling. 66/66 tests passing at ship.

</details>

<details>
<summary>✅ v1.1 Production Hardening (Phases 5-8) — SHIPPED 2026-03-16</summary>

Phases 5-8 hardened the runtime for real-world unattended use: per-agent process timeouts with SIGTERM→SIGKILL process-group escalation, pino NDJSON structured logging with delivery/agent/run correlation, concurrent delivery slots with graceful drain-on-shutdown, and an embedded MCP HTTP server enabling agents to publish follow-up events directly during execution. 116/116 tests passing at ship.

- [x] Phase 5: Foundation Safety (3/3 plans) — completed 2026-03-14
- [x] Phase 6: Structured Logging (2/2 plans) — completed 2026-03-15
- [x] Phase 7: Concurrent Workers (2/2 plans) — completed 2026-03-15
- [x] Phase 8: Embedded MCP Server (2/2 plans) — completed 2026-03-16

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### v1.2 Developer Experience (In Progress)

**Milestone Goal:** Make Agent Bus safer and more observable — event schema validation, web dashboard for real-time visibility, and legacy cleanup of the `events[]` result envelope pattern superseded by MCP.

- [ ] **Phase 9: Web Dashboard** - Local HTTP dashboard for real-time run, delivery, approval, and failure visibility via SSE
- [ ] **Phase 10: Event Schema Registry** - Per-topic payload validation at publish time with warn/reject enforcement modes
- [ ] **Phase 11: Deprecation** - Warn on legacy `events[]` result envelope usage while preserving backward compatibility

## Phase Details

### Phase 9: Web Dashboard
**Goal**: Operators can open a browser and see live run status, delivery details, pending approvals, and failures without running CLI commands
**Depends on**: Phase 8 (v1.1 complete)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Success Criteria** (what must be TRUE):
  1. Daemon starts a Hono HTTP server on localhost and logs its URL — operator opens the URL in a browser and sees a list of runs with their status summaries
  2. Clicking a run shows its deliveries with agent ID, state, and timing — the page updates live without a manual refresh as deliveries complete
  3. Pending approval queue is visible on the dashboard — operator can see what is waiting for `agent-bus approve` without running the CLI
  4. Dead-letter and failure queue is visible on the dashboard with agent ID, error summary, and retry count
  5. SSE connection drops (browser close, network interrupt) do not prevent `daemon.stop()` from resolving — shutdown completes cleanly
**Plans:** 3 plans
Plans:
- [ ] 09-01-PLAN.md — Hono deps, dispatcher EventEmitter, dashboard server with API routes
- [ ] 09-02-PLAN.md — SSE endpoint with shutdown safety, daemon integration, CLI flag
- [ ] 09-03-PLAN.md — Dashboard HTML/CSS/JS template with dark terminal aesthetic and live updates

### Phase 10: Event Schema Registry
**Goal**: Operators can declare per-topic payload schemas and catch mismatches at publish time, not deep in failed agent executions
**Depends on**: Phase 9
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SCHEMA-05, SCHEMA-06
**Success Criteria** (what must be TRUE):
  1. Operator adds a `schemas` section to `agent-bus.yaml` with a Zod-compatible schema for a topic, and invalid payloads published to that topic produce a structured warning on daemon stderr
  2. Operator sets `enforcement: reject` for a topic, and publishing an invalid payload returns a validation error without persisting the event to SQLite
  3. Publishing to a topic with no registered schema succeeds silently — existing agents and manifests without `schemas` sections are unaffected
  4. Daemon code can call `daemon.registerSchema(topic, zodSchema)` to register schemas programmatically at startup
  5. Valid payloads pass through without any observable latency impact or behavioral change
**Plans**: TBD

### Phase 11: Deprecation
**Goal**: Operators and agents get clear, actionable warnings when using the `events[]` pattern that MCP replaced, with zero breaking changes
**Depends on**: Phase 10
**Requirements**: DEPR-01, DEPR-02
**Success Criteria** (what must be TRUE):
  1. An agent result envelope that includes a non-empty `events` array causes a structured NDJSON warning line on daemon stderr with `level: "warn"` and the delivery ID
  2. All existing agents that use `events[]` continue to function exactly as before — no deliveries fail, no behavior changes
  3. The warning is filterable by `jq`/`grep` using the same correlation fields (`deliveryId`, `agentId`) as all other lifecycle log lines
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4. Core Runtime | v1.0 | 8/8 | COMPLETE | 2026-03-10 |
| 5. Foundation Safety | v1.1 | 3/3 | COMPLETE | 2026-03-14 |
| 6. Structured Logging | v1.1 | 2/2 | COMPLETE | 2026-03-15 |
| 7. Concurrent Workers | v1.1 | 2/2 | COMPLETE | 2026-03-15 |
| 8. Embedded MCP Server | v1.1 | 2/2 | COMPLETE | 2026-03-16 |
| 9. Web Dashboard | v1.2 | 0/3 | Planned | - |
| 10. Event Schema Registry | v1.2 | 0/TBD | Not started | - |
| 11. Deprecation | v1.2 | 0/TBD | Not started | - |
