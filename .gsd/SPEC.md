<!-- AUTO-GENERATED from .planning/PROJECT.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 2fe93f83d33de2b8c51d10ece135967935926c0f15169cf45b483f3d8a50285f. Edit the source file, not this projection. -->
> **Status**: `FINALIZED`

# Agent Bus

## What This Is

Agent Bus is a local-first, event-driven orchestration runtime for solo developers building software with multiple AI agent runtimes. It replaces manual, synchronous handoffs between planning, design, QA, and coding agents with a durable event bus, human approval gates, and file-based artifact passing inside a single repository workspace.

## Core Value

Enable asynchronous, event-driven coordination between multiple agent runtimes inside one repository on one machine with durable orchestration primitives and human-in-the-loop approval gates.

## Requirements

### Validated

<!-- Shipped and confirmed valuable in v1.0. -->

- ✓ REQ-01: Repository-local workflow manifest (agents, subscriptions, approval gates, commands, artifact conventions) — v1.0
- ✓ REQ-02: Event publishing with typed topics, metadata, and relative artifact paths — v1.0
- ✓ REQ-03: Subscription-based fan-out from events to deliveries — v1.0
- ✓ REQ-04: Approval gates for pending events before delivery — v1.0
- ✓ REQ-05: Durable persistence (SQLite) for events, deliveries, approvals, runs — v1.0
- ✓ REQ-06: At-least-once delivery with configurable retry — v1.0
- ✓ REQ-07: Dead-letter queue with inspection and replay — v1.0
- ✓ REQ-08: Event and delivery replay without manual DB edits — v1.0
- ✓ REQ-10: Runtime adapter contract for Codex, Gemini CLI, Open Code — v1.0
- ✓ REQ-11: CLI for runs, approvals, failures, replay, publish — v1.0
- ✓ REQ-12: Single-machine, single-repository operation model — v1.0

## Current Milestone: v1.1 Production Hardening

**Goal:** Harden the runtime for real-world use with process timeouts, structured logging, concurrent workers, env isolation, and an embedded MCP server for direct agent event publishing.

**Target features:**
- Process timeout for spawned agent processes
- Structured logging (replacing raw text logs)
- Concurrent workers (parallel delivery processing)
- Env isolation for spawned processes
- MCP Server embedded in daemon (publish_event, get_delivery, list_artifacts)

### Active

<!-- Current scope — building toward these. -->

(See Current Milestone above — requirements being defined)

### Out of Scope

- Multi-machine / distributed orchestration — v1.x is local-first
- Hosted SaaS / multi-tenant control plane — not a product goal
- Web dashboard in v1.x — CLI-first approach
- Generic task orchestration — software-delivery-first workflows only

## Context

- Node.js 22.12+ required (built-in `node:sqlite`)
- 66/66 tests passing on v1.0 baseline
- Runtime adapters: Codex, Gemini CLI, Open Code
- Gemini CLI replaced Antigravity as the stable runtime adapter
- Zero external dependencies beyond yaml + zod

## Constraints

- **Runtime**: Node.js 22.12+ with experimental SQLite — no external DB
- **Scope**: One machine, one repository, shared filesystem
- **Compatibility**: Manifest, envelope schema, CLI semantics must remain stable across refactors
- **Adapters**: CLI/wrapper-based invocation only, no GUI automation

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite as sole storage backend | Local-first, zero-config, built into Node 22 | ✓ Good |
| File-based artifact passing (not inline) | Avoids serializing large blobs into events | ✓ Good |
| Lease-based delivery claiming | Enables recovery from worker crashes | ✓ Good |
| Gemini CLI replaces Antigravity | Antigravity unstable, Gemini CLI more reliable | ✓ Good |
| YAML manifest for workflow config | Declarative, version-controllable | ✓ Good |

---
*Last updated: 2026-03-14 after v1.1 milestone started*
