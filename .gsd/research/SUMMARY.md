<!-- AUTO-GENERATED from .planning/research/SUMMARY.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Project Research Summary

**Project:** Agent Bus v1.1 — Production Hardening
**Domain:** Node.js event-driven daemon hardening — process lifecycle, observability, concurrency, security, MCP protocol embedding
**Researched:** 2026-03-14
**Confidence:** HIGH (stack, features, architecture based on direct codebase analysis; MEDIUM on MCP SDK version specifics)

## Executive Summary

Agent Bus v1.1 is a targeted production hardening release for an existing, well-structured local-first orchestration daemon. The v1.0 codebase is in better shape than a greenfield project: the process timeout mechanism already exists in `process-runner.ts` (just unwired), the env isolation gap is a single spread expression, and the SQLite WAL mode already handles concurrent access safely. The core work is completing plumbing that was partially built but never connected to the manifest configuration surface, plus two genuinely new features (structured logging and the embedded MCP server).

The recommended build order is strictly dependency-ordered: manifest schema changes first (all features read from here), then the lightweight safety fixes (timeout propagation, env isolation), then observability (structured logging), then concurrency (worker pool), then the largest new surface (MCP server). This order minimizes risk at each step — each phase lands on a stable foundation. The three low-complexity features (timeout wiring, env isolation, manifest schema) can be grouped into a single first phase and shipped with minimal test disruption.

The primary risks are not architectural but operational: process group kill on timeout (grandchildren survive SIGTERM to the direct child), lease duration must exceed process timeout or double-execution occurs, and the MCP server transport must be HTTP-on-localhost rather than stdio to avoid corrupting the daemon's output streams. All three risks are well-understood and have straightforward preventions that must be addressed before the relevant phases ship.

## Key Findings

### Recommended Stack

Four of five v1.1 features require zero new dependencies — they are wired using Node.js 22+ built-ins already in use. Only two new production packages are needed: `pino ^9.0.0` for structured daemon logging (de facto standard, no transitive deps, native ESM, child-logger support ideal for per-delivery context) and `@modelcontextprotocol/sdk ^1.0.0` for the embedded MCP server (official Anthropic SDK, TypeScript-first, includes `StreamableHTTPServerTransport`). The existing `yaml` and `zod` dependencies are unchanged and should be leveraged for MCP tool input schema derivation.

**Core technologies:**
- `node:child_process` (built-in): process spawning with SIGTERM/SIGKILL timeout escalation — already used, extend for process group kill
- `node:sqlite` WAL mode (built-in): concurrent access safe; single `DatabaseSync` connection sufficient for up to ~8 workers since real parallelism is at OS child-process level
- `pino ^9.0.0`: structured NDJSON daemon logging — no transitive deps, ESM-compatible, `pino.child()` for per-delivery context; verify version with `npm show pino version`
- `@modelcontextprotocol/sdk ^1.0.0`: `McpServer` + `StreamableHTTPServerTransport` for localhost HTTP MCP endpoint; verify `StreamableHTTPServerTransport` import path before implementation
- `node:net` `server.listen(0)` (built-in): OS-assigned free port for MCP HTTP server
- `Promise.allSettled` (built-in): N-slot concurrent worker pool coordination

**Note:** ARCHITECTURE.md recommends a custom internal logger with no external dependency (zero-dep philosophy); STACK.md recommends `pino`. Resolution: the features research confirms `pino` is consistent with the existing `yaml`/`zod` dep pattern. Use `pino` for production quality; the internal logger interface from ARCHITECTURE.md should be used as the abstraction so the implementation can be swapped.

### Expected Features

**Must have (table stakes) — production daemon safety requirements:**
- **Process timeout enforcement** — hung AI agents block lease slots indefinitely without it; mechanism exists in `process-runner.ts` but is never configured from the manifest
- **Structured logging (daemon internals)** — raw text is unqueryable; operators cannot correlate events across concurrent deliveries without structured fields (deliveryId, agentId, runId, level, ts)
- **Env isolation (spawned processes)** — current `...process.env` spread leaks daemon API keys and shell state into every agent process; this is a security and reproducibility failure
- **Concurrent workers** — single sequential loop processes one delivery at a time; long-running agents (10+ min) starve all other ready deliveries

**Should have (differentiators):**
- **MCP server embedded in daemon** — agents that are LLM sessions (Gemini, Codex) can publish follow-up events via MCP tools instead of writing a result envelope; removes the need for agents to implement the work package contract format
- **Timeout discrimination in dead-letter** — timeout result distinguished from crash (not just generic signal exit) enables instant triage

**Defer (v2+):**
- Log aggregation / CloudWatch / Loki integration — local-first tool; NDJSON to stderr is operator-greppable
- Web dashboard — stated out of scope; CLI-first
- MCP authentication — localhost-only; no network exposure in v1.1
- Dynamic worker pool scaling — static `--concurrency N` at startup is sufficient
- `events` array deprecation in result envelope — keep backward-compat in v1.1; deprecate in v1.2 after MCP adoption is observed

### Architecture Approach

The v1.1 architecture is an extension of the existing composition root pattern (`startDaemon()` in `daemon/index.ts`) with two new files and targeted modifications to existing modules. No new storage layer changes are required — all five features plug into existing seams. The key principle is that CLI-facing operator output (`cli/output.ts` to stdout) and daemon internal observability (structured logger to stderr) are two separate concerns that must never be merged. The MCP server must use HTTP localhost transport, not stdio, because the daemon process's stdio is already spoken for.

**Major components (new or modified for v1.1):**
1. `config/manifest-schema.ts` [MODIFY] — add `timeoutMs`, `envMode`, `mcpServer` config fields to `AgentSchema`; all other features read from here
2. `shared/logger.ts` [NEW] — structured JSON logger factory; `Logger` interface with `child()` for per-delivery context; writes to stderr
3. `daemon/worker-pool.ts` [NEW] — N-slot concurrent poll loop; slots share single `DatabaseSync` connection safely because child-process execution is the real parallelism
4. `daemon/mcp-server.ts` [NEW] — `StreamableHTTPServerTransport` on `127.0.0.1:PORT`; tools derive input schemas from existing Zod types; URL injected as `AGENT_BUS_MCP_URL` in work packages
5. `adapters/process-runner.ts` [MODIFY] — SIGTERM to process group (`-child.pid`), SIGKILL after grace period, env isolation per `envMode`
6. `daemon/adapter-worker.ts` [MODIFY] — pass `timeoutMs` from manifest into `ProcessMonitorCallbacks`, inject `mcpServerUrl` into work packages, emit structured log events

### Critical Pitfalls

1. **SIGTERM kills only the direct child, not the subprocess tree** — grandchildren (e.g., shell wrappers spawning the real agent binary) survive; use `process.kill(-child.pid, "SIGTERM")` to signal the entire process group; follow up with `SIGKILL` after 5s grace; clear the result file after timeout kill to prevent stale reads by the retry attempt.

2. **Lease duration shorter than process timeout causes double execution** — if `leaseDurationMs < processTimeoutMs + graceMs`, recovery-scan reclaims the lease while the original agent is still running; enforce `leaseDurationMs > timeoutMs + graceMs` as a startup validation with a clear error message.

3. **MCP stdio transport corrupts daemon output streams** — if stdio transport is used for the embedded MCP server, any `console.log` or structured log line to stdout breaks MCP JSON-RPC framing for connected clients; use `StreamableHTTPServerTransport` on localhost; structured logging must write to stderr only.

4. **Hung SQLite transaction after unhandled rejection in MCP handler** — concurrent MCP tool calls that crash mid-transaction leave the shared `DatabaseSync` connection in a `BEGIN` state; all subsequent queries fail with "cannot start a transaction within a transaction"; wrap all transaction boundaries in a `withTransaction(db, fn)` helper that guarantees `ROLLBACK` on any throw; add top-level try/catch in all MCP request handlers.

5. **Env isolation strips PATH, breaking executable resolution** — `gemini`, `codex`, `opencode` are resolved via PATH at spawn time; a strict allowlist that omits PATH causes `ENOENT` on every agent spawn, manifesting as dead-lettered deliveries; PATH is a mandatory passthrough in `envMode: "isolated"`; consider resolving to absolute paths at daemon startup to eliminate runtime PATH dependency.

## Implications for Roadmap

Based on combined research across all four files, the dependency graph is clear and the phase structure follows naturally.

### Phase 1: Foundation Safety (Manifest Schema + Process Timeouts + Env Isolation)

**Rationale:** These three changes are low-complexity, have no inter-feature dependencies, and address the most critical production safety gaps. The manifest schema changes are a prerequisite for all other features — they must land first. Process timeouts and env isolation are targeted single-file plumbing changes that validate the manifest-first approach. All three share the same files (manifest-schema.ts, process-runner.ts, registry.ts) so they belong in one phase.

**Delivers:** A daemon safe to run unattended — agent processes cannot hang indefinitely, daemon secrets do not leak to agents, and timeout configuration is per-agent in the manifest.

**Addresses (from FEATURES.md):** Process timeout enforcement, env isolation.

**Avoids (from PITFALLS.md):** Pitfall 1 (subprocess tree kill), Pitfall 3 (lease/timeout invariant), Pitfall 4 (env pollution), Pitfall 10 (PATH in isolation mode).

**Research flag:** Standard patterns — no further research phase needed. Direct codebase changes with well-understood Node.js primitives.

---

### Phase 2: Structured Logging

**Rationale:** Logging is additive-only (no behavior changes), which means it carries the lowest regression risk of any phase. It must precede concurrent workers because concurrent output without per-slot worker IDs in structured fields is impossible to debug. The transport decision (stderr only, never stdout) must be locked before this phase because it affects MCP server architecture.

**Delivers:** Queryable NDJSON daemon logs with correlation fields (deliveryId, agentId, runId, level, ts) and a `Logger` interface that all subsequent phases consume.

**Uses (from STACK.md):** `pino ^9.0.0` (verify version); `Logger` interface abstraction from ARCHITECTURE.md.

**Implements (from ARCHITECTURE.md):** `shared/logger.ts`; integration into `startDaemon()`, `AdapterWorker`, `RecoveryScan`.

**Avoids (from PITFALLS.md):** Pitfall 5 (test breakage — audit string assertions before implementation; inject transport in tests), Pitfall 7 (stdout corruption — stderr only), Pitfall 9 (sync write bottleneck — use async stream).

**Research flag:** Standard patterns — pino is well-documented. Pre-implementation step: audit test files for string-matching on log output; inject pluggable test transport.

---

### Phase 3: Concurrent Workers

**Rationale:** Builds on stable Phase 1 (manifest changes) and Phase 2 (structured logging for per-slot context). The new `worker-pool.ts` is a contained new file with minimal modification to existing code. The single `DatabaseSync` connection is safe for concurrent use because SQLite operations serialize on the JS call stack and child-process execution is the real parallelism.

**Delivers:** `--concurrency N` CLI flag (default 1, backward-compatible); up to N agent processes running simultaneously; graceful drain on `daemon.stop()`.

**Uses (from STACK.md):** `Promise.allSettled`, `node:sqlite` WAL mode — no new dependencies.

**Implements (from ARCHITECTURE.md):** `daemon/worker-pool.ts`; `worker-command.ts` CLI flag addition; drain-aware `stop()`.

**Avoids (from PITFALLS.md):** Pitfall 2 (single connection serialization — document, not a bug at N≤8), Pitfall 8 (recovery-scan / worker lease race — existing WHERE clause is safe; do not relax it), Pitfall 11 (false concurrency safety — atomic UPDATE claim must retain status constraint), Pitfall 14 (DB close while workers mid-flight — drain `Set<Promise>` before `database.close()`).

**Research flag:** Standard patterns — concurrent async slots over a single shared SQLite connection is a known pattern. No external research needed.

---

### Phase 4: Embedded MCP Server

**Rationale:** Largest new surface area; requires all prior phases to be stable before touching work package schema and daemon lifecycle. The `@modelcontextprotocol/sdk` import paths and `StreamableHTTPServerTransport` availability must be verified before implementation begins. Derives MCP tool input schemas from existing Zod domain types to prevent schema drift.

**Delivers:** `AGENT_BUS_MCP_URL` env var injected into work packages; agents can publish events, fetch delivery context, and list artifacts via MCP tool calls during execution; result envelope `events` array becomes optional (not deprecated until v1.2).

**Uses (from STACK.md):** `@modelcontextprotocol/sdk ^1.0.0`, `node:net` `server.listen(0)`, existing `zod` schemas for tool input validation.

**Implements (from ARCHITECTURE.md):** `daemon/mcp-server.ts`; `mcpUrl` field in work package `workspace` object; `getDelivery()` method on daemon facade; `mcpServer` config in `StartDaemonOptions`.

**Avoids (from PITFALLS.md):** Pitfall 6 (hung transaction — `withTransaction` helper; top-level handler catch), Pitfall 7 (stdio conflict — HTTP transport, locked in Phase 2), Pitfall 13 (schema drift — derive from existing Zod schemas).

**Research flag:** NEEDS research-phase verification before implementation: confirm `StreamableHTTPServerTransport` class name and import path in current SDK version (`npm show @modelcontextprotocol/sdk version`; review SDK changelog or source). Confirm `pino ^9` ESM import syntax works with `"type": "module"` (also applies to Phase 2 but most critical here).

---

### Phase Ordering Rationale

- Manifest schema changes are the foundation; no feature can land without them.
- Safety features (timeout, env isolation) before observability because they are simpler and reduce risk before we touch many files.
- Structured logging before concurrent workers because concurrent output is undebuggable without correlation fields.
- MCP server last because it has the largest blast radius (new dependency, new lifecycle, work package schema change, daemon facade change) and benefits most from all prior phases being stable.
- This order is consistent across all three research files (FEATURES.md, ARCHITECTURE.md recommend the same sequence independently).

### Research Flags

Phases needing deeper research during planning:
- **Phase 4 (MCP Server):** `StreamableHTTPServerTransport` import path must be verified against the installed SDK version before writing any code. Run `npm show @modelcontextprotocol/sdk` and inspect the package's `exports` map. The `McpServer.registerTool()` vs `server.tool()` API surface also needs verification.
- **Phase 2 (Structured Logging):** Run `npm show pino version` to confirm ^9.x is current stable before adding to `package.json`. Confirm ESM import (`import pino from 'pino'`) works with `"type": "module"`.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation Safety):** All changes are in-codebase plumbing with Node.js built-ins. No external research needed.
- **Phase 3 (Concurrent Workers):** `Promise.allSettled` slot pool is a well-documented pattern. SQLite WAL behavior is documented in Node.js 22 experimental API docs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (core) / MEDIUM (new deps) | Zero-dep features verified via direct codebase read. Pino version and MCP SDK transport API unverified against live npm — verify before install. |
| Features | HIGH | All gaps confirmed by direct codebase read of the specific lines where the gap exists. Feature list is internally consistent across FEATURES.md and ARCHITECTURE.md. |
| Architecture | HIGH | Component map derived from direct source analysis of all relevant files. Build order validated by cross-referencing FEATURES.md, ARCHITECTURE.md, and PITFALLS.md independently — all three agree. |
| Pitfalls | HIGH (Node.js/SQLite) / MEDIUM (MCP) | Process group kill, lease invariant, env isolation, SQLite serialization — all well-documented platform behavior. MCP embedding patterns are newer; transport strategy (HTTP vs stdio) is the main uncertainty, resolved by choosing HTTP. |

**Overall confidence:** HIGH for Phases 1-3. MEDIUM for Phase 4 (MCP) pending SDK API verification.

### Gaps to Address

- **MCP SDK transport API:** Verify `StreamableHTTPServerTransport` import path (`@modelcontextprotocol/sdk/server/streamableHttp.js`) and `McpServer` tool registration API against the installed version before Phase 4 planning. If the class name or import path differs, the architecture is still correct but code examples in ARCHITECTURE.md/FEATURES.md will need updating.
- **`pino` ESM compatibility:** Confirm `import pino from 'pino'` resolves correctly in the project's `"type": "module"` ESM build before Phase 2 implementation. Run a minimal smoke test.
- **`daemon.getDelivery()` facade method:** ARCHITECTURE.md identifies that `AgentBusDaemon` does not expose `getDelivery(deliveryId)` — only `listDeliveriesForEvent()`. A new method is required for the `get_delivery` MCP tool. Minor, but must be in Phase 4 scope.
- **`list_artifacts` scope definition:** ROADMAP.md mentions `list_artifacts` but does not define query shape (all artifacts vs filtered by topic/delivery). Needs clarification from project owner before Phase 4 implementation.
- **Logger interface conflict:** STACK.md recommends `pino`; ARCHITECTURE.md designs a custom internal logger. Resolution: use the `Logger` interface from ARCHITECTURE.md as the abstraction (preserving testability and zero-dep spirit in tests) with `pino` as the production backing implementation.

## Sources

### Primary (HIGH confidence)
- Direct codebase: `src/adapters/process-runner.ts` — timeout hook at line 44/130-133; env spread at lines 94-97
- Direct codebase: `src/cli/worker-command.ts` — sequential single-worker loop
- Direct codebase: `src/config/manifest-schema.ts` — confirmed absence of `timeoutMs`, `envMode`, MCP fields
- Direct codebase: `src/adapters/registry.ts` — `buildBaseEnvironment()` env merge behavior
- Direct codebase: `src/daemon/index.ts`, `src/daemon/adapter-worker.ts`, `src/daemon/delivery-service.ts`, `src/daemon/recovery-scan.ts`, `src/storage/delivery-store.ts`
- `.gsd/ROADMAP.md` — authoritative MCP server design intent
- MCP transport specification: https://modelcontextprotocol.io/docs/concepts/transports
- MCP TypeScript server quickstart: https://modelcontextprotocol.io/quickstart/server
- Node.js child_process documentation — process group signal behavior

### Secondary (MEDIUM confidence)
- pino npm: https://www.npmjs.com/package/pino — version ^9.x unverified against live registry
- `@modelcontextprotocol/sdk` npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk — `StreamableHTTPServerTransport` import path unverified against installed version

### Tertiary (LOW confidence)
- None

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
