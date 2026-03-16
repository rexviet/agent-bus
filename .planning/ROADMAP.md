# Roadmap: Agent Bus

## Milestones

- ✅ **v1.0 Core Runtime** — Phases 1-4 (shipped 2026-03-10)
- ✅ **v1.1 Production Hardening** — Phases 5-8 (shipped 2026-03-16)
- ○ **v1.2 Developer Experience** — SDK/library mode, event schema registry, web dashboard, plugin system for adapters
- ○ **v1.3 Scale & Ecosystem** — PostgreSQL backend option, distributed worker support, adapter marketplace, multi-repo orchestration

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

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1–4. Core Runtime | v1.0 | 8/8 | ✅ COMPLETE | 2026-03-10 |
| 5. Foundation Safety | v1.1 | 3/3 | ✅ COMPLETE | 2026-03-14 |
| 6. Structured Logging | v1.1 | 2/2 | ✅ COMPLETE | 2026-03-15 |
| 7. Concurrent Workers | v1.1 | 2/2 | ✅ COMPLETE | 2026-03-15 |
| 8. Embedded MCP Server | v1.1 | 2/2 | ✅ COMPLETE | 2026-03-16 |
