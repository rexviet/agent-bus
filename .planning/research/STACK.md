# Technology Stack

**Project:** Agent Bus v1.1 — Production Hardening
**Researched:** 2026-03-14
**Scope:** NEW capabilities only — process timeouts, structured logging, concurrent workers, env isolation, embedded MCP server

---

## Summary

Four of the five v1.1 features require zero new dependencies. They are implemented with Node.js 22+ built-ins already available in the codebase. Only the embedded MCP server requires a new external package.

The existing zero-external-dep philosophy should be maintained everywhere possible. Add `@modelcontextprotocol/sdk` as the sole new production dependency.

---

## Feature-by-Feature Stack Decisions

### 1. Process Timeouts

**Decision: No new dependency. Wire existing `timeoutMs` field.**

The infrastructure already exists. `ProcessMonitorCallbacks.timeoutMs` (process-runner.ts line 44) triggers `child.kill("SIGTERM")` after the configured duration. The gap is upstream configuration:

- `AgentSchema` in `manifest-schema.ts` does not yet have a `timeoutMs` field.
- The worker loop in `worker-command.ts` does not yet pass `timeoutMs` into the `ProcessMonitorCallbacks`.
- No SIGKILL escalation exists if SIGTERM is ignored (common with editor-mode CLIs like Gemini).

**Implementation path:**
- Add `timeoutMs?: number` to `AgentSchema` in manifest-schema.ts (per-agent timeout).
- Pass the agent's timeout into `ProcessMonitorCallbacks.timeoutMs` in adapter-worker.ts.
- Add SIGKILL escalation: after SIGTERM, wait `graceMs` (e.g. 5s), then `child.kill("SIGKILL")`.

**Node.js APIs used:** `setTimeout`, `clearTimeout`, `child.kill()` — all in `node:child_process` + built-in timers. No library.

**Confidence: HIGH** — existing implementation visible in source.

---

### 2. Structured Logging

**Decision: Add `pino` ~^9.x as the daemon's internal logger.**

**Why pino:**
- De facto standard for Node.js structured (newline-delimited JSON) logging.
- Single production dependency: `pino` has no transitive runtime dependencies of its own in v9.
- Tiny API surface: `const log = pino(); log.info({ deliveryId }, "Claimed delivery")`.
- Outputs NDJSON to stdout by default — pipeable to `pino-pretty` for development, or to log aggregators in CI/ops contexts.
- Compatible with ESM `"type": "module"` projects (full ESM support since pino 8).
- `pino.child({ workerId })` creates child loggers with inherited context — fits worker-per-delivery pattern perfectly.

**Why not roll custom JSON logger:**
- Naively serializing `JSON.stringify` to stderr is fragile — no level filtering, no caller context, no child logger scoping. Pino solves all of these with battle-tested correctness.

**Why not winston:**
- Winston has many transitive dependencies, is larger, and slower. Not the right fit for a minimal local daemon.

**Scope of change:**
- Add `pino` to `dependencies` in `package.json`.
- Create `src/shared/logger.ts` with a factory that produces a root logger.
- Replace `console.log`/`io.stdout.write` daemon-internal output with structured log calls.
- Agent process output (stdout/stderr piped to `.log` files) is NOT structured — agents are external processes and their log format is not controlled. Leave agent log files as-is.

**Version:** pino ^9.0.0 (v9 is current stable as of 2025; full ESM support, no breaking changes expected in minor versions).

**Confidence: MEDIUM** — version based on training data knowledge of pino 9 release timeline (2024). Verify exact latest with `npm show pino version` before installing.

---

### 3. Concurrent Workers

**Decision: No new dependency. Parallel `Promise.allSettled` over N worker iterations.**

The current `worker-command.ts` runs a single `while` loop polling one delivery at a time. Concurrency means running N simultaneous `runWorkerIteration` calls.

**Key insight:** SQLite's `DatabaseSync` (node:sqlite) uses WAL mode. Multiple readers are fine. The delivery `claim()` uses a row-level lease — concurrent callers each get a distinct delivery (or null if the queue is empty). This is already safe for parallel use because claim is a write transaction serialized by SQLite.

**Implementation approach:**
- Add `--concurrency N` flag to the worker command (default: 1 for backward compatibility).
- Replace the single `while` loop with a slot-based pool: maintain N concurrent async "slots" that each run a polling loop. Each slot: claim → process → ack/fail → repeat or sleep-if-idle.
- Use `Promise.race` / `Promise.allSettled` to coordinate slots.
- Worker ID per slot: `${workerId}-slot-${index}` to distinguish lease owners in the DB.

**No `node:worker_threads` needed:** Agent processes are already isolated OS processes spawned via `child_process.spawn`. Worker threads would add complexity without benefit — the bottleneck is agent process duration, not JS event loop throughput.

**Confidence: HIGH** — architecture analysis of existing codebase.

---

### 4. Env Isolation

**Decision: No new dependency. Remove `...process.env` spread in process-runner.ts.**

Current behavior in `runPreparedAdapterCommand` (process-runner.ts line 94-97):
```typescript
env: {
  ...process.env,           // ← leaks daemon's full env to every agent
  ...input.execution.environment
}
```

This leaks the daemon's full environment (including `PATH`, auth tokens, API keys, shell vars) into every spawned agent process.

**Isolation strategy:**
- Provide a minimal base env: `{ PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "" }`.
- Let manifest `agent.environment` be the primary mechanism for passing additional vars (already supported).
- Add an `env_mode` field to `AgentSchema`: `"inherit"` (current behavior, default for backward compat) | `"isolated"` (minimal base only).

**Why keep `PATH`:** Agent executables (gemini, codex) need PATH resolution. A truly empty env breaks `child_process.spawn` for named commands.

**Confidence: HIGH** — directly visible in process-runner.ts line 94-97.

---

### 5. Embedded MCP Server

**Decision: Add `@modelcontextprotocol/sdk` as new production dependency.**

**Why this library:**
- Official Anthropic-maintained SDK for building MCP servers and clients in TypeScript/Node.js.
- Provides `Server` class, tool registration (`server.tool()`), and multiple transport implementations.
- ESM-compatible, TypeScript-first with included type definitions.
- No heavy transitive dependencies — designed for embedding.

**Transport choice: `StreamableHTTPServerTransport` (HTTP on localhost random port)**

The ROADMAP specifies "connection info (stdio/HTTP) passed to agents via work package env vars." For an embedded server in the same daemon process:

- `StdioServerTransport`: Requires the MCP server to be a separate process communicating over stdin/stdout. Cannot be embedded in the daemon process.
- `StreamableHTTPServerTransport`: Binds to a localhost port. The daemon starts it, picks a random available port, and injects `AGENT_BUS_MCP_URL=http://localhost:{port}` into each agent's work package environment. Agents call the HTTP endpoint to invoke `publish_event`, `get_delivery`, or `list_artifacts`.

**Why HTTP over stdio for the embedded case:**
- Agents are separate processes — they cannot share stdin/stdout with the daemon.
- HTTP localhost is language-agnostic: any agent (Python, shell, Node) can `curl` or use an MCP client.
- Port is ephemeral — no config file needed, injected fresh per daemon start.
- HTTP transport has session management built into the SDK.

**MCP tools to expose:**

| Tool | Purpose | Input |
|------|---------|-------|
| `publish_event` | Agent publishes follow-up event directly | `topic`, `payload`, `artifactRefs?`, `dedupeKey?` |
| `get_delivery` | Agent fetches its own delivery context | `deliveryId` |
| `list_artifacts` | Agent lists available artifacts for a run | `runId` |

**Work package schema change:** Add `mcpServerUrl?: string` to `AdapterWorkspaceSchema` in contract.ts. Populated by daemon when MCP server is active, absent when not (opt-in via manifest or CLI flag).

**Result envelope simplification (ROADMAP):** When agents use `publish_event` via MCP, the `events` array in `SuccessfulAdapterResultSchema` becomes redundant. The roadmap notes this simplification — research recommends keeping `events` for backward compat in v1.1, deprecating in v1.2.

**Version:** `@modelcontextprotocol/sdk` ^1.x. The SDK reached 1.0 stable in late 2024. Use `^1.0.0` as the floor.

**Confidence: MEDIUM** — MCP SDK architecture based on training data + public docs knowledge. Exact version and `StreamableHTTPServerTransport` availability should be verified with `npm show @modelcontextprotocol/sdk version` and reviewing the SDK changelog before implementation.

**Port binding:** Use `node:net` `server.listen(0)` to get an OS-assigned free port. Built into Node.js — no library needed.

---

## Full Dependency Delta

### Production Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `pino` | `^9.0.0` | Structured JSON daemon logging |
| `@modelcontextprotocol/sdk` | `^1.0.0` | Embedded MCP server with HTTP transport |

### Existing Dependencies (unchanged)

| Package | Version | Status |
|---------|---------|--------|
| `yaml` | `^2.8.2` | Manifest loading |
| `zod` | `^4.3.6` | Schema validation (also used for MCP tool input schemas) |

### Dev Dependencies (unchanged)

| Package | Version | Status |
|---------|---------|--------|
| `@types/node` | `^22.15.30` | Node.js type definitions |
| `typescript` | `^5.9.3` | Compiler |

### NOT Adding

| What | Why Not |
|------|---------|
| `node:worker_threads` (separate thread pool library) | Agents are OS processes — JS concurrency buys nothing |
| `winston` / `bunyan` / `signale` | Heavier than pino with no benefit for this use case |
| A process manager (`pm2`, `execa`) | `node:child_process.spawn` is sufficient and already used |
| `express` / `fastify` for MCP HTTP | MCP SDK's `StreamableHTTPServerTransport` includes its own HTTP handling |
| `dotenv` | Env isolation is handled at spawn time — no .env file loading needed |
| `p-limit` / `p-queue` | Concurrent slot pool is simple enough to implement inline with `Promise.allSettled` |

---

## Node.js 22+ Built-ins Leveraged

| Feature | Node.js API | Used For |
|---------|------------|---------|
| Process spawn | `node:child_process.spawn` | Already used — extend for timeout escalation |
| Timers | `setTimeout` / `clearTimeout` | Timeout SIGTERM + SIGKILL escalation |
| Port discovery | `node:net` `server.listen(0)` | MCP HTTP server free port |
| SQLite WAL | `node:sqlite` (experimental) | Already used — safe for concurrent reads |
| File I/O | `node:fs/promises` | Already used for work packages and results |

---

## Integration Points

### Process Timeouts → Manifest Schema
```
agent.timeoutMs → ProcessMonitorCallbacks.timeoutMs → child.kill("SIGTERM") → [grace] → child.kill("SIGKILL")
```

### Structured Logging → Daemon Layers
```
src/shared/logger.ts (pino root) → child loggers per component → NDJSON to daemon stdout
Agent process logs remain unstructured files in logsDir
```

### Concurrent Workers → Worker Command
```
--concurrency N → N parallel slot loops → each calls runWorkerIteration with slot workerId → claim serialized by SQLite
```

### Env Isolation → Process Runner
```
agent.env_mode: "isolated" → spawn with { PATH, HOME } + agent.environment only
agent.env_mode: "inherit" → current behavior (default, backward compat)
```

### MCP Server → Daemon Startup
```
startDaemon() → create McpServer → bind HTTP port → inject AGENT_BUS_MCP_URL into work packages
tools: publish_event calls daemon.publish(), get_delivery calls deliveryStore, list_artifacts reads filesystem
```

---

## Sources

- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/adapters/process-runner.ts` (timeout stub at line 44, env spread at lines 94-97)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/cli/worker-command.ts` (single-worker poll loop)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/adapters/registry.ts` (env injection via `buildBaseEnvironment`)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/config/manifest-schema.ts` (AgentSchema — no timeoutMs or env_mode today)
- Project context: `/Users/macbook/Data/Projects/agent-bus/.planning/PROJECT.md`
- Roadmap: `/Users/macbook/Data/Projects/agent-bus/.planning/ROADMAP.md` (MCP design intent)
- pino npm: https://www.npmjs.com/package/pino (MEDIUM confidence — version unverified)
- MCP SDK npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk (MEDIUM confidence — transport API unverified against latest)

---

## Pre-Implementation Verification Checklist

Before coding begins, verify:

- [ ] `npm show pino version` → confirm ^9.x is current stable
- [ ] `npm show @modelcontextprotocol/sdk version` → confirm ^1.x is current stable
- [ ] Confirm `StreamableHTTPServerTransport` exists in `@modelcontextprotocol/sdk` and its import path (check SDK source or CHANGELOG)
- [ ] Confirm `pino` ^9 ESM import syntax (`import pino from 'pino'`) works with `"type": "module"`
- [ ] Confirm `node:sqlite` WAL mode allows concurrent read transactions from the same process (already relies on this — verify write serialization behavior under concurrent claim calls)
