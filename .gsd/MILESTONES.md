<!-- AUTO-GENERATED from .planning/MILESTONES.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Milestones

## v1.0 — Core Runtime (Complete)

**Shipped:** 2026-03-10
**Phases:** 1–4

Event-driven orchestration runtime with durable SQLite persistence, delivery state machine (lease, retry, dead-letter, replay), approval gates, runtime adapters for Codex/Gemini/Open Code, CLI operator tooling, and manifest-driven configuration.

**Key results:**
- 66/66 tests passing
- Full operator workflow demo (publish → approve → fan-out → complete)
- Deterministic demo agent for testing
