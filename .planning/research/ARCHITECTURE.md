# Architecture Patterns

**Domain:** Local-first event-driven agent orchestration runtime (v1.1 Production Hardening)
**Researched:** 2026-03-14
**Confidence:** HIGH — based on direct codebase analysis

---

## Current Architecture (v1.0 Baseline)

The daemon is a single-process orchestrator. `startDaemon()` in `src/daemon/index.ts` is the composition root: it wires all stores, services, and the adapter worker together then returns an `AgentBusDaemon` facade.

```
CLI entrypoint (src/cli.ts)
  └── startDaemon() [src/daemon/index.ts]
        ├── SQLite stores: EventStore, DeliveryStore, ApprovalStore, RunStore
        ├── Dispatcher (in-memory notification log)
        ├── ApprovalService
        ├── DeliveryService
        ├── AdapterWorker
        │     └── process-runner (spawn, pipe stdout/stderr to log file)
        ├── ReplayService
        ├── OperatorService
        └── RecoveryScan (setInterval)
```

The worker poll loop lives in `src/cli/worker-command.ts` and calls `daemon.runWorkerIteration()` sequentially — one delivery at a time per worker process.

### Key Integration Points for v1.1

| Feature | Existing Hook | Gap |
|---------|--------------|-----|
| Process timeouts | `ProcessMonitorCallbacks.timeoutMs` exists in `process-runner.ts` (line 44, 130-133) | Not wired into manifest or StartDaemon options — plumbing is there but the value is never passed |
| Structured logging | Text output via `src/cli/output.ts` and raw file append in `process-runner.ts` | No structured (JSON) logger object; log calls are ad-hoc `stream.write()` |
| Concurrent workers | Single sequential `runWorkerIteration()` loop per process | No pool — `worker-command.ts` awaits each iteration before starting the next |
| Env isolation | `buildBaseEnvironment()` in `registry.ts` merges `agent.environment` with full `process.env` | `process.env` leak: all parent env vars passed to every spawned process |
| MCP server | `AgentBusDaemon` facade exposes `publish()`, `claimDelivery()`, etc. | No HTTP or stdio transport layer; no MCP protocol handler |

---

## Recommended Architecture for v1.1

### Component Map: New vs Modified

```
src/
  adapters/
    process-runner.ts          [MODIFY] — read timeoutMs from manifest agent config
  config/
    manifest-schema.ts         [MODIFY] — add timeoutMs, allowedEnvKeys to AgentSchema
  daemon/
    index.ts                   [MODIFY] — accept logger, wire timeoutMs, start MCP server
    adapter-worker.ts          [MODIFY] — pass logger to process-runner callbacks
    mcp-server.ts              [NEW]    — MCP protocol handler (stdio transport)
    worker-pool.ts             [NEW]    — concurrent worker loop manager
  shared/
    logger.ts                  [NEW]    — structured logger factory (JSON, leveled)
```

No new storage layer changes are required for any of these features. All five features plug into existing seams.

---

## Feature Integration Details

### 1. Process Timeouts

**Where the hook already exists:**

`ProcessMonitorCallbacks.timeoutMs?: number` is already read in `runPreparedAdapterCommand()` (line 130). When set, it calls `child.kill("SIGTERM")` after the timeout. The plumbing is complete.

**What is missing:**

- `AgentSchema` in `manifest-schema.ts` does not have a `timeoutMs` field.
- `buildAdapterCommand()` in `registry.ts` does not read any timeout value.
- `adapter-worker.ts` does not pass `timeoutMs` into the `monitor` object it receives.
- `StartDaemonOptions` has no `defaultTimeoutMs` field.

**Integration pattern:**

```
manifest: agent.timeoutMs (optional, per-agent override)
  → AgentSchema adds: timeoutMs: z.number().int().positive().optional()
  → adapter-worker.ts reads agent.timeoutMs at claim time
  → passes monitor: { ...existingMonitor, timeoutMs: agent.timeoutMs ?? defaultTimeoutMs }
  → process-runner.ts already handles it
```

**Signal behavior:** Current code sends SIGTERM. No SIGKILL follow-up exists. The child may ignore SIGTERM. For v1.1, a follow-up SIGKILL after a grace period (e.g., 5s) should be added inside `runPreparedAdapterCommand()` — this is a self-contained change to `process-runner.ts`.

**Delivery outcome on timeout:** The process exits with `signal: "SIGTERM"` (or null if it catches and ignores the signal). The existing error path in `adapter-worker.ts` (lines 405-433) already routes signal exits to `deliveryService.fail()` (retry). No new state machine transitions needed.

---

### 2. Structured Logging

**Current state:** All output goes through `src/cli/output.ts` using plain `stream.write()` text. Agent process stdout/stderr is piped to a flat log file. No structured logger object exists anywhere in the codebase.

**Recommended approach:** A minimal internal logger — not a third-party library — consistent with the zero-external-dependencies constraint (only `yaml` and `zod` are dependencies).

**New file: `src/shared/logger.ts`**

```typescript
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}
```

Output format: newline-delimited JSON (`{ "ts": "ISO", "level": "info", "msg": "...", ...fields }`). Written to `process.stderr` by default (so structured logs do not pollute stdout for CLI consumers).

**Integration points:**

- `startDaemon()` accepts an optional `logger?: Logger`. If not provided, uses a no-op logger. This preserves all existing tests.
- `AdapterWorker` receives the logger and emits structured events: `delivery.claimed`, `delivery.completed`, `delivery.failed`, `process.started`, `process.completed`.
- `RecoveryScan` logs `recovery.scan` with counts.
- `MCP server` (new) uses the logger for connection events.
- CLI `worker-command.ts` creates the logger when `--log-format json` is passed (new flag).

**Do not replace `cli/output.ts` text output.** That is the operator-facing UX. Structured logging is for daemon internals — two separate concerns.

---

### 3. Concurrent Workers

**Current state:** `worker-command.ts` runs a single `while` loop, sequentially `await`-ing each `daemon.runWorkerIteration()`. This means one delivery processes at a time per worker process.

**New file: `src/daemon/worker-pool.ts`**

```typescript
export interface WorkerPoolOptions {
  readonly concurrency: number;         // Number of parallel slots
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly retryDelayMs?: number;
  readonly pollIntervalMs: number;
  readonly runIteration: (workerId: string, ...) => Promise<...>;
  readonly onResult?: (result: ...) => void;
  readonly onIdle?: () => void;
}

export function createWorkerPool(options: WorkerPoolOptions): {
  start(): void;
  stop(): Promise<void>;
}
```

**Design:** N concurrent slots, each running its own poll loop. When a slot finds no work, it waits `pollIntervalMs` then retries. Slots are independent — no shared queue coordination needed because the delivery store's `claimNextDelivery()` is already atomic (SQLite serializes concurrent writes).

**SQLite concurrency concern (MEDIUM confidence):** Node.js's `node:sqlite` (experimental, WAL mode) serializes writes but allows concurrent reads. Since `claimNextDelivery()` is a write (`UPDATE ... WHERE status = 'ready' LIMIT 1`), concurrent calls from the same database connection will serialize. The `DatabaseSync` API is synchronous — no async/await — which means multiple concurrent JS calls to `claimNextDelivery()` will run in turn, not in parallel, at the SQLite level. This is safe: no double-claim risk.

**What does parallelize:** Each `runPreparedAdapterCommand()` spawns a child process and awaits its exit. These child processes run truly in parallel (OS-level). So with `concurrency: 4`, up to 4 agent processes can run simultaneously. The SQLite operations between them serialize fine because they're fast and infrequent relative to agent process run time.

**CLI change:** `worker-command.ts` adds `--concurrency N` flag (default 1). When N=1, behavior is identical to current (backwards-compatible).

---

### 4. Env Isolation

**Current state:** In `process-runner.ts` line 94-97:

```typescript
env: {
  ...process.env,           // <-- full parent environment leaked
  ...input.execution.environment
}
```

And in `registry.ts` `buildBaseEnvironment()`, agent-defined environment vars (`agent.environment`) plus AGENT_BUS_* vars are built. But they are merged on top of `process.env`, not replacing it.

**Recommended isolation model:**

Two modes, configured per-agent in the manifest:

- `envMode: "inherit"` (default, backwards-compatible) — current behavior, `process.env` + agent env
- `envMode: "isolated"` — only the AGENT_BUS_* contract vars + explicit `agent.environment` entries + a minimal safe set (`PATH`, `HOME`, `USER`, `TMPDIR`, `LANG`, `TERM`)

**Manifest schema change:**

```typescript
// In AgentSchema
envMode: z.enum(["inherit", "isolated"]).default("inherit")
```

**Registry change:** `buildBaseEnvironment()` returns only the AGENT_BUS_* vars plus `agent.environment`. The caller (`process-runner.ts`) decides whether to prepend `process.env` based on `envMode`.

**Process-runner change:** `PreparedAdapterCommand` gains an optional `envMode` field. `runPreparedAdapterCommand()` builds `env` as:

```typescript
const safeBase = envMode === "isolated"
  ? pickSafeParentEnv(process.env)   // PATH, HOME, USER, TMPDIR, LANG, TERM
  : process.env;
env: { ...safeBase, ...input.execution.environment }
```

No new files required for this feature.

---

### 5. MCP Server

**Scope from ROADMAP.md:** Agents publish events directly via MCP tool (`publish_event`) instead of (or in addition to) the result envelope. Result envelope is simplified: `status` + `outputArtifacts`. MCP tools: `publish_event`, `get_delivery`, `list_artifacts`. Connection info passed via work package env vars.

**Transport choice:** stdio is the correct choice for embedding in the daemon process that spawns child processes. HTTP (SSE or streamable HTTP per MCP 2025-03 spec) would be better for multi-client access but requires a TCP port and auth. For v1.1 (single-machine, local-first), stdio transport on a dedicated pipe or Unix socket is sufficient. Recommend: **HTTP on localhost with a randomly assigned port**, written into each work package as `AGENT_BUS_MCP_URL`. This avoids process-level stdio conflicts (the agent's own stdout/stderr is already used for log capture).

**New file: `src/daemon/mcp-server.ts`**

```typescript
export interface McpServerOptions {
  readonly daemon: AgentBusDaemon;
  readonly logger?: Logger;
  readonly port?: number;   // 0 = OS-assigned
}

export interface McpServer {
  readonly url: string;     // http://127.0.0.1:<port>
  stop(): Promise<void>;
}

export async function startMcpServer(options: McpServerOptions): Promise<McpServer>
```

**MCP protocol:** The MCP specification (2024-11 and 2025-03) uses JSON-RPC 2.0. For a localhost HTTP server, the streamable HTTP transport (POST `/mcp`) is the current spec. The server does not require the full `@modelcontextprotocol/sdk` — the transport can be implemented with Node.js built-in `node:http`. Tool dispatch is a small JSON-RPC router.

**Three tools to expose:**

| Tool | Input | Output | Maps to daemon method |
|------|-------|--------|-----------------------|
| `publish_event` | `{ topic, payload, artifactRefs?, dedupeKey? }` | `{ eventId }` | `daemon.publish(envelope)` |
| `get_delivery` | `{ deliveryId }` | Delivery record | `daemon.listDeliveriesForEvent()` or new `getDelivery()` |
| `list_artifacts` | `{ pattern? }` | `string[]` (paths) | filesystem scan of `layout.workspaceDir` |

**Work package integration:** When MCP server starts, its URL is injected into the work package `workspace` object (new field `mcpUrl?: string`) and surfaced as an env var `AGENT_BUS_MCP_URL`. Agents that want to publish mid-run POST to this URL instead of (or in addition to) writing a result envelope.

**Result envelope simplification:** Once agents can publish via MCP, the `events` array in the result envelope becomes optional/deprecated. The `success` result only needs `status`, `outputArtifacts`, and optional `summary`. This is backwards-compatible — `events: []` (the default) still works.

**Authentication:** For v1.1 (single machine, single user), no authentication on the MCP server is required. The URL is not published beyond the work package env var. This is a local-only trust boundary.

**Integration into `startDaemon()`:**

```typescript
// StartDaemonOptions gains:
readonly mcpServer?: {
  readonly enabled: boolean;
  readonly port?: number;
}

// startDaemon() conditionally starts MCP server and stores the URL
// in layout or passes it down when building work packages
```

**`adapter-worker.ts` change:** When building work packages, if `mcpServerUrl` is set on the daemon, it is included in the `workspace` object and passed as env var. This is the only change to the work package contract — backwards-compatible since it's additive.

---

## Data Flow Changes (v1.0 → v1.1)

### v1.0 Flow

```
claim delivery
  → build work package (no mcpUrl)
  → spawn process (inherits full process.env, no timeout)
  → pipe stdout+stderr to flat log file
  → wait for exit (no timeout)
  → read result.json (events array)
  → publish follow-up events
  → acknowledge delivery
```

### v1.1 Flow

```
claim delivery (potentially from concurrent slot N of M)
  → build work package (mcpUrl injected if MCP enabled)
  → spawn process (isolated or inherited env, timeout set)
  → pipe stdout+stderr to flat log file; structured log: process.started
  → wait for exit OR timeout (SIGTERM → SIGKILL after grace period)
  → structured log: process.completed
  → read result.json (events optional — agent may have published via MCP)
  → publish any remaining follow-up events from result.json
  → acknowledge delivery
  → structured log: delivery.completed
```

The MCP path runs in parallel with the spawned process: agent publishes events mid-run via HTTP POST → daemon handles publish_event → fans out deliveries immediately (before the agent process exits). The result envelope `events` array is then a fallback for agents that do not use MCP.

---

## Component Boundaries After v1.1

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `daemon/index.ts` | Composition root, lifecycle | All layers |
| `daemon/adapter-worker.ts` | Single delivery execution | process-runner, stores, dispatcher |
| `daemon/worker-pool.ts` (new) | N concurrent worker slots | adapter-worker |
| `daemon/mcp-server.ts` (new) | MCP HTTP transport, tool routing | daemon facade |
| `daemon/delivery-service.ts` | Delivery state transitions | deliveryStore, runStore, dispatcher |
| `daemon/recovery-scan.ts` | Stale lease recovery, approval fan-out | stores, dispatcher |
| `adapters/process-runner.ts` | spawn, timeout, log pipe | OS child_process |
| `adapters/registry.ts` | Build adapter command + env | vendor adapters |
| `shared/logger.ts` (new) | Structured JSON log emission | stderr |
| `config/manifest-schema.ts` | Zod schema for agent-bus.yaml | all consumers |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Replacing cli/output.ts with the structured logger

**What:** Routing operator-facing CLI text output through the new JSON logger.
**Why bad:** CLI consumers expect human-readable text. JSON output on `agent-bus runs list` would break the operator UX. The two concerns — operator UX output and daemon internal observability — must stay separate.
**Instead:** Keep `cli/output.ts` as-is. Logger writes to `stderr` (or a configurable log file). CLI text goes to `stdout`.

### Anti-Pattern 2: Putting the MCP server on stdio

**What:** Using stdio transport (as in the MCP SDK's default) for the embedded MCP server in the daemon.
**Why bad:** The daemon process already uses its own stdio for CLI output. Child processes use stdin (ignored) and stdout/stderr (piped to log files). Sharing stdio between the daemon and an MCP transport creates multiplexing complexity.
**Instead:** HTTP on localhost (random port). URL passed via work package env var. Simple, no multiplexing needed.

### Anti-Pattern 3: Sharing a single `DatabaseSync` connection across concurrent workers with a connection pool

**What:** Creating multiple `DatabaseSync` instances thinking it will improve concurrency.
**Why bad:** `node:sqlite` (WAL mode) allows concurrent readers but serializes writers. `claimNextDelivery()` is a write. Multiple connections do not speed this up and add complexity. The real concurrency win comes from parallel child process execution, not parallel SQLite writes.
**Instead:** Single `DatabaseSync` connection. The pool just runs multiple independent JS async loops that share it. SQLite serializes naturally.

### Anti-Pattern 4: Making timeoutMs a daemon-global config only

**What:** One timeout for all agents, set at the CLI level.
**Why bad:** Different agents have wildly different expected run times. A planning agent might legitimately run for 10 minutes; a formatter might time out in 30 seconds.
**Instead:** Per-agent `timeoutMs` in the manifest, with a daemon-level `defaultTimeoutMs` fallback for agents that do not specify.

### Anti-Pattern 5: Adding MCP authentication for v1.1

**What:** Adding API keys, JWT, or mutual TLS to the MCP server endpoint.
**Why bad:** Adds complexity that provides no real security benefit on a single-user local machine. The attack surface is `localhost` only.
**Instead:** No auth for v1.1. Document the trust boundary clearly. Add auth when/if multi-user or remote scenarios emerge (v1.3+).

---

## Build Order (Dependency-Ordered)

The features have the following dependency chain:

```
1. manifest-schema.ts changes (timeoutMs, envMode, mcpServer config)
   └── all other features consume the new manifest fields

2. shared/logger.ts (new, standalone)
   └── no dependencies on other new features

3. Process timeouts (process-runner.ts + registry.ts + adapter-worker.ts)
   └── depends on manifest-schema.ts changes only
   └── lowest risk, existing plumbing, targeted change

4. Env isolation (process-runner.ts + registry.ts)
   └── depends on manifest-schema.ts changes (envMode field)
   └── touches same files as timeout but orthogonal change

5. Structured logging (logger.ts → daemon/index.ts → adapter-worker.ts)
   └── depends on logger.ts being created
   └── additive only — no behavior changes

6. Concurrent workers (worker-pool.ts → worker-command.ts)
   └── depends on adapter-worker.ts being stable (after timeout + logging changes)
   └── new file + CLI flag addition — low coupling risk

7. MCP server (mcp-server.ts → daemon/index.ts → adapter-worker.ts → contract.ts)
   └── depends on all above being stable
   └── largest new surface area; additive to work package schema
   └── should be built last — most integration points
```

**Recommended phase order:**

| Phase | Features | Rationale |
|-------|----------|-----------|
| Phase 1 | manifest-schema changes + process timeouts + env isolation | Pure configuration + targeted plumbing. Validates manifest-first approach. Low risk, high value. |
| Phase 2 | structured logging | Additive only. Makes Phase 3+ observable. No behavior risk. |
| Phase 3 | concurrent workers | Builds on stable adapter-worker. New file, minimal modification. |
| Phase 4 | MCP server | Largest new surface. Requires all prior phases stable. Changes work package schema (additive). |

---

## Scalability Considerations

| Concern | v1.1 (local, 1-4 workers) | v1.2+ |
|---------|--------------------------|-------|
| SQLite write contention | Non-issue: claims serialize, agents run in parallel | Consider WAL checkpoint tuning |
| MCP server throughput | Single-threaded Node.js HTTP sufficient for local use | Add connection pooling if multi-tenant |
| Log volume | Per-run flat files + structured daemon log | Add log rotation (size/age) |
| Timeout enforcement | SIGTERM + SIGKILL grace period | Per-agent escalation policy |

---

## Open Questions

1. **MCP result envelope simplification timing:** Should `events` in `AdapterResultEnvelope` be deprecated in v1.1 (when MCP launches) or kept fully supported indefinitely? Backwards-compatible to keep; simplifies agent authoring to deprecate. Recommend: keep `events` working, add `mcpUrl` as an opt-in path. Deprecation in v1.2.

2. **Worker pool stop behavior:** When `stop()` is called on a running pool, should in-flight deliveries be allowed to complete (graceful) or killed immediately? Graceful is safer (avoids retry storms) but may delay shutdown. Recommend: graceful with a configurable `shutdownTimeoutMs`.

3. **MCP `list_artifacts` scope:** The ROADMAP says `list_artifacts` but does not define the query shape. Does it list all artifacts in `workspaceDir`? Filter by topic convention? Filter by current delivery's `artifactRefs`? Needs clarification before implementing.

4. **`get_delivery` storage gap:** `AgentBusDaemon` does not expose a `getDelivery(deliveryId)` method — only `listDeliveriesForEvent()`. A new `getDelivery()` method is needed on the daemon facade (delegating to `deliveryStore.getDelivery()`). Minor addition.

---

## Sources

- Direct codebase analysis: `src/adapters/process-runner.ts`, `src/daemon/adapter-worker.ts`, `src/daemon/index.ts`, `src/daemon/worker-pool.ts`, `src/cli/worker-command.ts`, `src/adapters/registry.ts`, `src/config/manifest-schema.ts` — HIGH confidence
- ROADMAP.md MCP server description — HIGH confidence (authoritative project intent)
- MCP specification transport model (HTTP vs stdio) — MEDIUM confidence (based on training data knowledge of MCP 2024-11 and 2025-03 specs; `node:sqlite` WAL behavior is documented in Node.js 22 experimental docs)
