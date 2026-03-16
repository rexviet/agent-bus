<!-- AUTO-GENERATED from .planning/MILESTONES.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 275f9e8789ebcc86075679159fe4312db567f2cfa627fcbb182a91966d0d0c29. Edit the source file, not this projection. -->

# Milestones

## v1.1 Production Hardening (Shipped: 2026-03-16)

**Phases:** 5–8 | **Plans:** 9 | **Timeline:** 2026-03-14 → 2026-03-16 (2 days)
**Tests:** 116/116 passing | **Files changed:** 144 | **~13,600 LOC TypeScript**

Hardened the runtime for real-world unattended use: process timeouts with SIGTERM→SIGKILL escalation targeting full process trees, pino-based NDJSON structured logging with delivery/agent/run correlation fields, concurrent worker slots with graceful drain-on-shutdown, and an embedded MCP HTTP server so agents can publish follow-up events directly during execution.

**Key accomplishments:**
- Per-agent `timeout` field in manifest with SIGTERM→SIGKILL process-group escalation and retry-on-timeout (not dead-letter)
- pino NDJSON lifecycle logs on stderr with `deliveryId`, `agentId`, `runId`, `workerId` — filterable by `jq`/`grep` with no extra tooling
- `--concurrency N` concurrent delivery slots with serialized claiming and graceful drain on SIGTERM/SIGINT
- Drain-timeout force-kill: reuses Phase 5 process-group kill when slots exceed `--drain-timeout-ms`
- Embedded MCP HTTP server: agents receive `AGENT_BUS_MCP_URL` and can call `publish_event` instead of writing result envelope `events`
- 14/14 requirements satisfied, 4/4 phases Nyquist-compliant, full cross-phase integration verified

---

## v1.0 — Core Runtime (Complete)

**Shipped:** 2026-03-10
**Phases:** 1–4

Event-driven orchestration runtime with durable SQLite persistence, delivery state machine (lease, retry, dead-letter, replay), approval gates, runtime adapters for Codex/Gemini/Open Code, CLI operator tooling, and manifest-driven configuration.

**Key results:**
- 66/66 tests passing
- Full operator workflow demo (publish → approve → fan-out → complete)
- Deterministic demo agent for testing
