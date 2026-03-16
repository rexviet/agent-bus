# Agent Bus

## What This Is

Agent Bus is a local-first, event-driven orchestration runtime for solo developers building software with multiple AI agent runtimes. It replaces manual, synchronous handoffs between planning, design, QA, and coding agents with a durable event bus, human approval gates, concurrent delivery processing, structured observability, and file-based artifact passing inside a single repository workspace.

## Core Value

Enable asynchronous, event-driven coordination between multiple agent runtimes inside one repository on one machine with durable orchestration primitives and human-in-the-loop approval gates.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

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
- ✓ TIMEOUT-01: Per-agent process timeout via `timeout` field in manifest — v1.1
- ✓ TIMEOUT-02: SIGTERM to agent process group (not just direct child) on timeout — v1.1
- ✓ TIMEOUT-03: SIGKILL escalation after 5s grace period if process group persists — v1.1
- ✓ TIMEOUT-04: Timed-out delivery scheduled for retry, not dead-lettered — v1.1
- ✓ LOG-01: NDJSON structured log lines to stderr for all delivery lifecycle events — v1.1
- ✓ LOG-02: Correlation fields `deliveryId`, `agentId`, `runId`, `level`, `timestamp` on every log line — v1.1
- ✓ LOG-03: Operator can filter daemon stderr with `jq`/`grep` by deliveryId or agentId — v1.1
- ✓ WORKER-01: `--concurrency N` flag to run up to N deliveries in parallel — v1.1
- ✓ WORKER-02: Default concurrency 1, backward-compatible single-delivery behavior — v1.1
- ✓ WORKER-03: Graceful drain of in-flight deliveries on shutdown — v1.1
- ✓ MCP-01: Embedded MCP HTTP server starts with daemon on localhost — v1.1
- ✓ MCP-02: `AGENT_BUS_MCP_URL` injected into agent work package env — v1.1
- ✓ MCP-03: Agent can call `publish_event` MCP tool during execution — v1.1
- ✓ MCP-04: Identity-file agents can use MCP instead of `events` array in result envelope — v1.1

### Active

<!-- Next milestone scope — to be defined in /gsd:new-milestone. -->

(None — define next milestone with `/gsd:new-milestone`)

### Out of Scope

- Multi-machine / distributed orchestration — v1.x is local-first
- Hosted SaaS / multi-tenant control plane — not a product goal
- Web dashboard in v1.x — CLI-first approach
- Generic task orchestration — software-delivery-first workflows only
- MCP authentication — localhost-only, no network exposure in v1.x
- `events` array deprecation in result envelope — keep backward-compat; deprecate in v1.2 after MCP adoption

## Context

- Node.js 22.12+ required (built-in `node:sqlite`)
- 116/116 tests passing on v1.1 baseline
- Runtime adapters: Codex, Gemini CLI, Open Code, Claude Code (added during v1.1)
- pino ^9.0.0 added for structured NDJSON logging
- @modelcontextprotocol/sdk ^1.27.1 added for embedded MCP server
- Tech debt from v1.1: `--mcp-port 0` rejected by CLI validator (minimum should be 0 not 1); MCP shutdown race under forced drain (low severity)

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
| pino with optional destination injection | ESM-safe, no worker thread; tests inject custom stderr stream | ✓ Good |
| Per-delivery child logger (not global) | Binds deliveryId/agentId/runId/workerId at claim time | ✓ Good |
| Serialized claim start + concurrent slot execution | Claim mutex prevents double-claim; slots run concurrently after claim | ✓ Good |
| MCP server starts before adapter worker | Guarantees AGENT_BUS_MCP_URL available before first delivery | ✓ Good |
| Timeout routes to retry not dead-letter | Transient hanging is retryable; only fatal errors dead-letter | ✓ Good |
| `--mcp-port 0` minimum = 1 (not 0) | Oversight; should be 0 for ephemeral binding; workaround: omit flag | ⚠️ Revisit |

---
*Last updated: 2026-03-16 after v1.1 milestone*
