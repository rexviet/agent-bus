<!-- AUTO-GENERATED from .planning/research/FEATURES.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Feature Landscape

**Domain:** Node.js daemon process hardening — process timeouts, structured logging, concurrent workers, env isolation, embedded MCP server
**Researched:** 2026-03-14
**Confidence:** HIGH (codebase verified + MCP official docs verified)

---

## Existing Foundation (Already Shipped — Do Not Re-Implement)

These are in v1.0 and out of scope:

| Existing Feature | Location |
|-----------------|----------|
| Event publish, fan-out, approval gates | `daemon/publish-event.ts`, `daemon/approval-service.ts` |
| Delivery state machine (lease/retry/dead-letter/replay) | `daemon/delivery-service.ts`, `daemon/adapter-worker.ts` |
| Process spawning + stdio capture | `adapters/process-runner.ts` |
| `ProcessMonitorCallbacks` (onStart, onComplete, onStdout, onStderr) | `adapters/process-runner.ts` |
| `timeoutMs` field on `ProcessMonitorCallbacks` with SIGTERM | `adapters/process-runner.ts` lines 130-133 |
| `--verbose` flag streaming agent output to terminal | `cli/worker-command.ts` |
| CLI operator tooling | `src/cli/` |

**Key insight:** The timeout mechanism exists in the code — `timeoutMs` is already wired in `process-runner.ts`. What is missing is the manifest/config surface to configure it and propagation through the daemon into the worker.

---

## Table Stakes

Features that are expected in a production daemon process. Missing = runtime is not safe to run unattended.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| **Process timeout enforcement** | AI agent processes can hang indefinitely; without timeout, a stuck agent blocks the lease slot and prevents recovery | Low | `timeoutMs` already in `ProcessMonitorCallbacks`; needs manifest field + propagation through `AdapterWorkerOptions` |
| **Structured logging (daemon)** | Raw text is unqueryable; operators need to correlate events across runs, agents, and deliveries; unstructured logs cannot be piped to log aggregators | Medium | New logger module; replaces scattered `console.log` calls in daemon startup and recovery scan |
| **Env isolation (spawned processes)** | Currently `...process.env` spreads all parent env vars (including API keys, shell state) into every agent process; agents should not inherit credentials they don't need | Low | `buildBaseEnvironment` in `adapters/registry.ts` already constructs agent env; needs a clean-env mode stripping parent |
| **Concurrent workers** | Sequential polling processes one delivery at a time; long-running agents (10+ min) starve other ready deliveries | High | Requires parallel `runWorkerIteration` calls; must handle SQLite write serialization (WAL mode already enabled) |

---

## Differentiators

Features that are not universally expected but are high-value for this specific use case.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| **MCP server embedded in daemon (publish_event, get_delivery, list_artifacts)** | Agents that are themselves LLM sessions (Gemini, Codex) can publish follow-up events without writing a full result envelope — they call MCP tools instead; removes the need for agents to know the work package contract format | High | Requires `@modelcontextprotocol/sdk` as new runtime dependency; stdio transport conflicts with daemon terminal — must use Streamable HTTP on localhost; exposes existing `daemon.publish()`, `deliveryStore.getDelivery()`, filesystem listing |
| **Timeout result in structured log + dead-letter** | When agent times out, the operator needs to know it was a timeout (not a crash) — separate signal vs generic process_error makes triage instant | Low | Extends timeout handling already in `process-runner.ts`; adds `timed_out` signal discrimination in `adapter-worker.ts` |

---

## Anti-Features

Features to explicitly NOT build in v1.1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full log aggregation / Loki / CloudWatch integration** | Out of scope for local-first tool; adds external service dependencies | Write NDJSON to existing `logsDir`; operators can tail or pipe as needed |
| **Web dashboard for log viewing** | Stated as out of scope in `PROJECT.md` — CLI-first | Structured NDJSON is grep-friendly |
| **MCP authentication / multi-tenant access control** | Local-only tool; MCP server on localhost 127.0.0.1 is not exposed to network | Bind to 127.0.0.1 only; no auth layer needed for v1.1 |
| **Dynamic worker pool scaling** | Over-engineering for solo developer tool; static concurrency configured at startup is sufficient | `--concurrency N` CLI flag |
| **MCP SSE transport (push notifications to clients)** | Adds complexity; agents call tools synchronously; bidirectional streaming is not needed for publish_event/get_delivery | Use Streamable HTTP with single POST/response pattern |
| **Structured logging for spawned agent processes** | Agents write their own logs; agent-bus only captures their stdout/stderr to a file | Capture remains file-based; daemon emits structured log entries about agent lifecycle (start, complete, timeout) |

---

## Feature Details

### 1. Process Timeout Enforcement

**What is missing:** The `timeoutMs` field exists in `ProcessMonitorCallbacks` (confirmed in `process-runner.ts` lines 128-133), and SIGTERM is already sent. However:
- No `timeout` field exists in the manifest agent schema (`manifest-schema.ts`)
- `timeoutMs` is never populated when building `ProcessMonitorCallbacks` in `worker-command.ts`
- A timed-out process currently produces a generic signal-exit result (signal `SIGTERM`) — indistinguishable from an intentional kill

**Expected behavior:**
- Manifest declares `timeout: 1800` (seconds) per agent
- Worker reads manifest timeout and passes `timeoutMs` into monitor
- On timeout, delivery is failed with a message like `Agent timed out after 1800s (SIGTERM)` — not dead-lettered, because timeout may be transient; retried with the normal retry policy
- Timeout event is emitted to the structured log

**Complexity:** Low. The spawn/kill mechanism is already implemented.

---

### 2. Structured Logging

**What is missing:**
- Daemon startup, recovery scan, delivery lifecycle — all use raw text output or no logging at all
- No correlation fields (deliveryId, agentId, runId, timestamp, level) across log entries
- Agent log files are plain text streams (fine; do not change)

**Expected behavior for daemon-level logs:**
- NDJSON lines to stderr (or a log file under `logsDir`)
- Each line: `{ "ts": "ISO8601", "level": "info|warn|error", "msg": "...", ...context }`
- Context fields: `deliveryId`, `agentId`, `topic`, `runId` where applicable
- Events to log: daemon start, recovery scan results, delivery claimed, process started, process completed (with exitCode/elapsedMs), delivery acked/failed/dead-lettered, timeout fired
- No third-party logging library — a thin internal logger writing JSON lines is sufficient given zero-external-dependency constraint

**Complexity:** Medium. Touches many files. No new dependency needed.

---

### 3. Concurrent Workers

**What is missing:**
- `worker-command.ts` runs a sequential `while` loop — one delivery at a time
- `AdapterWorkerOptions.monitor` is a single callbacks object — it would collide if two agents run simultaneously and write to the same terminal labels

**Expected behavior:**
- `--concurrency N` flag (default 1 for backward compatibility)
- N parallel slots, each runs `runWorkerIteration` independently
- Each slot has its own workerId suffix (e.g., `worker-1234/0`, `worker-1234/1`)
- SQLite WAL mode (already enabled) handles concurrent reads; writes serialize naturally
- Lease-based claiming prevents double-processing — two slots cannot claim the same delivery
- Structured logging must include slot/workerId to disambiguate concurrent output

**Key constraint:** `ProcessMonitorCallbacks` are shared currently. With concurrent workers, each iteration needs its own callbacks bound to the delivery being processed — this is already possible because `runWorkerIteration` creates per-delivery paths, but the `monitor` on `AdapterWorkerOptions` is a single object. Must either pass monitor per-iteration or remove the shared monitor object in favor of per-iteration callbacks.

**Complexity:** High. Requires restructuring the worker loop and the monitor binding pattern.

---

### 4. Env Isolation

**What is missing:**
- `process-runner.ts` line 94-97: `env: { ...process.env, ...input.execution.environment }` — parent environment is spread in full
- An agent gets `HOME`, `PATH`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, shell state, and every other env var from the daemon process

**Expected behavior:**
- Clean env mode: only pass a minimal safe set of env vars to agent processes
- Required pass-through: `PATH`, `HOME`, `USER`, `SHELL`, `TERM` (needed for CLI tools to function)
- Agent-specific vars: `agent.environment` map from manifest (already supported)
- Agent Bus contract vars: `AGENT_BUS_*` (already set in `buildBaseEnvironment`)
- Manifest-level `inheritEnv: false` (default) vs `inheritEnv: true` (opt-in for agents that need full parent env)
- An `allowedEnvKeys` list in manifest agent config for selective pass-through

**Complexity:** Low. One targeted change in `buildBaseEnvironment` or `process-runner.ts`.

---

### 5. MCP Server (publish_event, get_delivery, list_artifacts)

**What is required:**
- New runtime dependency: `@modelcontextprotocol/sdk` (TypeScript SDK, npm package `@modelcontextprotocol/sdk`)
- Transport choice: **Streamable HTTP on localhost** — not stdio. Reason: The daemon process's stdio is already in use by the terminal or piped to the worker command's output. Using stdio transport for MCP would conflict. Streamable HTTP on `127.0.0.1:PORT` is the correct pattern for an embedded server in a long-running daemon.
- Port: configurable in manifest `workspace.mcpPort` or `--mcp-port` CLI flag; default e.g. 7831

**Tools to expose:**

| Tool | Input | Output | Maps to |
|------|-------|--------|---------|
| `publish_event` | `topic`, `payload`, `artifactRefs?` | `eventId`, `deliveryIds[]` | `daemon.publish()` |
| `get_delivery` | `deliveryId` | delivery record fields | `deliveryStore.getDelivery()` |
| `list_artifacts` | `directory?` | file listing with metadata | `fs.readdir()` on `artifactsDir` |

**Expected behavior:**
- MCP server starts when daemon starts (opt-in via manifest or CLI flag)
- Bound to `127.0.0.1` only — never `0.0.0.0`
- No authentication for v1.1 (local machine only)
- Agent processes receive `AGENT_BUS_MCP_URL=http://127.0.0.1:PORT/mcp` in their environment
- The MCP server uses the daemon's existing in-memory SQLite connection — no separate DB connection
- Server lifecycle tied to daemon lifecycle (starts in `startDaemon`, stops in `daemon.stop()`)

**Key constraint from MCP spec:** For stdio-based MCP servers (the common pattern), `console.log` to stdout is forbidden as it corrupts JSON-RPC framing. Agent-bus daemon is not a stdio MCP server; it uses HTTP, so this constraint does not apply to the daemon itself. However, structured logging must write to stderr or log files, not stdout, to keep the daemon's stdout clean for potential future stdio use.

**SDK API (TypeScript, verified from official MCP quickstart):**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// server.registerTool(name, { description, inputSchema }, handler)
// handler receives validated args, returns { content: [{ type: "text", text: "..." }] }
```

**Complexity:** High. New dependency, new server lifecycle, HTTP port management, tool schema definitions, integration with daemon's publish path.

---

## Feature Dependencies

```
Process timeout manifest field
  → timeoutMs propagation through AdapterWorkerOptions.monitor
  → timeout discrimination in adapter-worker result handling

Structured logging
  → Logger module (internal, no dependency)
  → All daemon lifecycle call sites updated to use logger
  → Concurrent workers need workerId/slot in log context

Env isolation
  → buildBaseEnvironment refactored
  → Manifest schema: agent.envIsolation or agent.inheritEnv
  → No other dependencies

Concurrent workers
  → Structured logging (disambiguate output)
  → Per-iteration monitor binding (refactor needed)
  → Does NOT require env isolation or MCP

MCP server
  → @modelcontextprotocol/sdk added to dependencies
  → Daemon start/stop lifecycle extended
  → Manifest schema: workspace.mcpPort (optional)
  → Agent env: AGENT_BUS_MCP_URL injected
  → Does NOT require concurrent workers or structured logging (but benefits from both)
```

---

## MVP Recommendation for v1.1

Build in this order based on complexity and dependency chain:

1. **Env isolation** — Low complexity, high safety value, no dependencies
2. **Process timeout (manifest surface)** — Low complexity, uses existing mechanism
3. **Structured logging** — Medium complexity, unlocks clean concurrent output
4. **Concurrent workers** — High complexity, depends on structured logging for clean output
5. **MCP server** — High complexity, independent of other four but most impactful for agent UX

**Defer:**
- Timeout dead-letter vs retry policy tuning — post-v1.1 once real timeout patterns are observed
- MCP authentication — not needed for local-only operation

---

## Confidence Assessment

| Feature | Confidence | Source |
|---------|------------|--------|
| Process timeout (mechanism exists) | HIGH | Direct codebase read — `process-runner.ts` lines 128-133 |
| Process timeout (manifest gap) | HIGH | Direct codebase read — `manifest-schema.ts` has no timeout field |
| Structured logging (gap) | HIGH | Direct codebase read — no logger module exists |
| Env isolation (gap) | HIGH | Direct codebase read — `process-runner.ts` line 94 spreads `process.env` |
| Concurrent workers (gap) | HIGH | Direct codebase read — sequential while loop in `worker-command.ts` |
| MCP SDK TypeScript API | HIGH | Official MCP quickstart docs + transport spec verified |
| MCP HTTP transport requirement | HIGH | MCP spec: stdio transport needs dedicated stdin/stdout; daemon cannot use stdio |
| MCP SDK npm package name | MEDIUM | Verified from official docs (`@modelcontextprotocol/sdk`); version number not verified (no npm access) |

---

## Sources

- MCP transport specification: https://modelcontextprotocol.io/docs/concepts/transports
- MCP TypeScript server quickstart: https://modelcontextprotocol.io/quickstart/server
- MCP tools concept: https://modelcontextprotocol.io/docs/concepts/tools
- Codebase: `src/adapters/process-runner.ts` (timeout mechanism, env spread)
- Codebase: `src/adapters/registry.ts` (buildBaseEnvironment)
- Codebase: `src/config/manifest-schema.ts` (no timeout/env fields)
- Codebase: `src/cli/worker-command.ts` (sequential loop, single monitor)
- Codebase: `src/daemon/index.ts` (daemon lifecycle, publish surface)
