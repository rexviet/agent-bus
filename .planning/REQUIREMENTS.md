# Requirements: Agent Bus

**Defined:** 2026-03-17
**Core Value:** Enable asynchronous, event-driven coordination between multiple agent runtimes inside one repository on one machine with durable orchestration primitives and human-in-the-loop approval gates.

## v1.2 Requirements

Requirements for v1.2 Developer Experience milestone. Each maps to roadmap phases.

### Schema Registry

- [ ] **SCHEMA-01**: Operator can declare JSON Schema per topic in `agent-bus.yaml` `schemas` section
- [ ] **SCHEMA-02**: Operator can register schemas programmatically via `daemon.registerSchema(topic, schema)`
- [ ] **SCHEMA-03**: Payload is validated against registered schema at publish time
- [ ] **SCHEMA-04**: Validation runs in warn mode by default (log warning, allow publish)
- [ ] **SCHEMA-05**: Operator can set per-topic enforcement to `reject` (publish fails on invalid payload)
- [ ] **SCHEMA-06**: Topics without registered schemas continue to work without validation

### Web Dashboard

- [ ] **DASH-01**: Hono HTTP server starts with daemon, bound to localhost
- [ ] **DASH-02**: Dashboard displays list of runs with status summary
- [ ] **DASH-03**: Dashboard displays delivery details per run (state, agent, timing)
- [ ] **DASH-04**: Dashboard displays pending approval queue
- [ ] **DASH-05**: Dashboard displays failure/dead-letter queue
- [ ] **DASH-06**: SSE endpoint pushes delivery lifecycle events in real time
- [ ] **DASH-07**: Dashboard UI updates live via SSE without manual refresh
- [ ] **DASH-08**: Dashboard served as plain HTML + vanilla JS (no build pipeline)

### Deprecation

- [ ] **DEPR-01**: Structured warning logged when agent result envelope contains `events` array
- [ ] **DEPR-02**: `events` array continues to function (no breaking change)

## Future Requirements

Deferred to v1.3+.

### SDK / Library Mode

- **SDK-01**: package.json `exports` field for clean ESM subpath imports
- **SDK-02**: Stable named public types (no internal store type leakage)
- **SDK-03**: Simplified `publish()` return type for external consumers
- **SDK-04**: Programmatic publish/subscribe for test harnesses

### Plugin Adapter System

- **PLUG-01**: Open adapter registry (mutable Map instead of closed switch)
- **PLUG-02**: Manifest `plugin` field for ESM dynamic import at startup
- **PLUG-03**: Typed `AdapterPlugin` interface exported from public surface
- **PLUG-04**: Fail-fast validation of plugin modules at daemon start

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Dashboard approval actions (approve/reject from browser) | Safety-critical decisions stay in CLI; dashboard is read-only |
| Schema backward-compatibility checking | Confluent-grade complexity; payloads are internal to single repo |
| Schema registry as separate process | Local-first; schemas live in manifest or registered in-process |
| WebSocket for dashboard | SSE sufficient for one-directional updates |
| Dashboard authentication | Localhost-only; same security model as MCP server |
| React/SPA build pipeline | Plain HTML + vanilla JS; no bundler in main package |
| Dynamic plugin hot-reload | ESM module reload unreliable; restart daemon instead |
| npm publish / release automation | Local-first tool; use `npm link` or `file:` paths |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DASH-01 | Phase 9 | Pending |
| DASH-02 | Phase 9 | Pending |
| DASH-03 | Phase 9 | Pending |
| DASH-04 | Phase 9 | Pending |
| DASH-05 | Phase 9 | Pending |
| DASH-06 | Phase 9 | Pending |
| DASH-07 | Phase 9 | Pending |
| DASH-08 | Phase 9 | Pending |
| SCHEMA-01 | Phase 10 | Pending |
| SCHEMA-02 | Phase 10 | Pending |
| SCHEMA-03 | Phase 10 | Pending |
| SCHEMA-04 | Phase 10 | Pending |
| SCHEMA-05 | Phase 10 | Pending |
| SCHEMA-06 | Phase 10 | Pending |
| DEPR-01 | Phase 11 | Pending |
| DEPR-02 | Phase 11 | Pending |

**Coverage:**
- v1.2 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 — traceability mapped after roadmap creation*
