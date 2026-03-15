<!-- AUTO-GENERATED from .planning/research/PITFALLS.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Domain Pitfalls

**Domain:** Node.js event-driven daemon — adding process timeouts, structured logging, concurrent workers, env isolation, embedded MCP server to existing SQLite + lease-based system
**Researched:** 2026-03-14
**Confidence:** HIGH for Node.js/SQLite patterns (direct codebase analysis + known platform behavior); MEDIUM for MCP embedding (protocol is young, embedding patterns are sparse in public record)

---

## Critical Pitfalls

Mistakes that cause data corruption, infinite hangs, or require rewrites.

---

### Pitfall 1: SIGTERM Does Not Kill the Subprocess Tree

**What goes wrong:** `child.kill("SIGTERM")` (line 133, `process-runner.ts`) sends SIGTERM to the direct child process only. If the spawned agent launches grandchild processes (e.g., `gemini` spawning a Node.js worker, or a shell wrapper spawning the real binary), those grandchildren are not signaled. The lease expires and recovery-scan reclaims the delivery, but the grandchildren keep running, consuming tokens and potentially writing to the result file after the lease is gone.

**Why it happens:** `spawn()` does not create a new process group by default. SIGTERM targets one PID. Wrapper scripts (`#!/bin/sh`) frequently exec into another process, making the shell the direct child and the real agent an orphaned grandchild.

**Consequences:**
- Delivery is reclaimed and retried while the original agent is still running, causing double execution
- Agent writes to `resultFilePath` after timeout; the file is read by the wrong retry attempt
- Resource leak: zombie AI API sessions burning quota with no owner

**Prevention:**
- Spawn with `detached: true` and kill the entire process group: `process.kill(-child.pid, "SIGTERM")`. Fall back to `child.kill("SIGTERM")` if `child.pid` is undefined.
- After SIGTERM, wait a grace period (e.g., 5 seconds) then send SIGKILL to the group.
- Clear the result file after a timeout kill, before the timeout is reported, so no stale result can be read by a later attempt.

**Detection:** Lease expiry in recovery-scan coincides with a still-running process in `ps aux`. Agent log file grows after the delivery transitions out of `leased` state.

**Phase:** Process Timeouts phase.

---

### Pitfall 2: Single SQLite Connection Serializes All Concurrent Workers

**What goes wrong:** Node.js `node:sqlite` `DatabaseSync` is a synchronous, single-connection handle. The existing daemon opens one connection shared by all stores. When concurrent workers are added, multiple async paths call synchronous SQLite operations on the same connection simultaneously within the same event loop turn. Because JS is single-threaded this doesn't corrupt data, but it does mean that a long `claimNextDelivery` transaction (SELECT + UPDATE inside BEGIN/COMMIT) blocks every other SQLite operation for its entire duration.

**Why it happens:** `DatabaseSync` is blocking-synchronous and not connection-pool aware. WAL mode allows one writer and multiple readers, but all go through the same file handle here. The `busy_timeout = 5000` pragma only helps if a second SQLite connection opens the same file — it does nothing within a shared connection.

**Consequences:**
- Concurrent workers do not actually run their SQLite operations in parallel; they serialize on the JS call stack
- With N workers each doing `claim → process → ack`, the claim step becomes a thundering-herd SELECT/UPDATE on the same connection
- Not a correctness bug but a performance cliff when N > 3-4

**Prevention:**
- For concurrency up to ~4-8 workers on a local machine, the single shared connection is fine for correctness. Document this explicitly rather than discovering it under load.
- If true parallel claiming is needed, workers must open separate `DatabaseSync` connections to the same WAL-mode file. Each connection gets its own write lock via SQLite's WAL protocol.
- Do NOT share a single `DatabaseSync` connection across multiple Node.js `Worker` threads (if ever added) — `DatabaseSync` is not thread-safe.

**Detection:** Profiling shows all SQLite calls serialized. Worker throughput plateaus despite N workers.

**Phase:** Concurrent Workers phase.

---

### Pitfall 3: Lease Duration Shorter Than Process Timeout

**What goes wrong:** A process timeout of (e.g.) 10 minutes is configured, but the lease duration is 5 minutes. The recovery-scan reclaims the lease and schedules a retry at minute 5. At minute 7, the original process finishes successfully and writes its result file. At minute 8, the retry attempt claims the delivery, spawns a new process, and finds the result file already present from the first run — or worse, the first run's result is read by `loadResultEnvelopeIfPresent` on a delivery that is no longer leased by that worker (stale lease check in `finalizeLeaseBoundTransition` saves us from the ack, but the file is still there to confuse the next worker).

**Why it happens:** Timeout and lease duration are configured independently with no enforced relationship. Easy to set inconsistent values in the manifest or daemon startup options.

**Consequences:**
- Double execution of expensive agent work
- Confusing log output: "process completed" after "lease reclaimed"
- Difficult to reproduce because it depends on wall-clock timing

**Prevention:**
- Enforce `leaseDurationMs > processTimeoutMs + graceMs` at daemon startup, failing fast with a clear error message.
- As a rule of thumb: `leaseDurationMs = processTimeoutMs * 1.5 + recoveryIntervalMs`.
- Document the invariant in manifest schema comments.

**Detection:** Warning sign is any delivery that transitions `leased → retry_scheduled` and then shortly after has a result file present from the first attempt.

**Phase:** Process Timeouts phase (must validate lease/timeout relationship when timeout is introduced).

---

### Pitfall 4: Environment Pollution from `...process.env` in Child Spawning

**What goes wrong:** `process-runner.ts` line 94 spreads the full daemon's `process.env` into every child process: `env: { ...process.env, ...input.execution.environment }`. This is the current behavior. When env isolation is added, if the merge order is wrong or the allowlist is incomplete, agent processes receive secrets meant only for the daemon (e.g., `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AWS_*` credentials held by the daemon itself for MCP or config purposes).

**Why it happens:** The spread-and-override pattern is idiomatic Node.js but is "deny by exception" rather than "allow by allowlist". Any variable not explicitly overridden leaks through.

**Consequences:**
- Security: agent processes (which may write files or call external APIs) receive credentials they shouldn't
- Debugging confusion: agent behavior changes based on the operator's shell environment, not just the manifest
- Hermetic reproducibility is impossible: same manifest, different operator shell = different agent env

**Prevention:**
- Env isolation must construct a fresh env from explicit sources only: OS minimal set (PATH, HOME, TMPDIR, USER, LANG), manifest-defined `environment` block, and Agent Bus contract vars (`AGENT_BUS_*`).
- Use an allowlist schema in the manifest (e.g., `envPassthrough: [PATH, HOME]`) rather than a denylist.
- Add a test that spawns a child with a poisoned parent env variable and asserts the child does not receive it.

**Detection:** Log the full env received by child processes in a test. Look for variables not in the manifest's `environment` block.

**Phase:** Env Isolation phase.

---

### Pitfall 5: Structured Logging Breaks Existing Test Assertions on Raw Text Output

**What goes wrong:** Current tests (66 passing) likely assert on console output, error messages, or log files as raw text strings. Introducing a structured logger that emits JSON lines (or a structured format) will change the output format. Tests that match on exact strings ("error: delivery not found") will fail against JSON `{"level":"error","message":"delivery not found","deliveryId":"..."}`.

**Why it happens:** Structured logging is a format change, not just a behavior change. It touches every code path that currently calls `console.log` / `console.error` or writes to log files.

**Consequences:**
- Large test breakage across the suite on day one of the logging PR
- Temptation to compromise: keep raw logs for tests, structured for production — leading to two code paths

**Prevention:**
- Audit all test files for string-matching on log output before starting the logging implementation.
- Design the logger with a pluggable transport: in tests, inject a transport that captures structured records as objects (not strings), so tests assert on `record.message` rather than raw strings.
- Add a `LOG_FORMAT=json|text` env var so human-readable format can still be used in local development.

**Detection:** Run `npm test` immediately after adding the logger and before touching any call sites. The failure count tells you the scope.

**Phase:** Structured Logging phase — audit must precede implementation.

---

### Pitfall 6: MCP Server Sharing the Daemon's DatabaseSync Connection Across Async HTTP Boundaries

**What goes wrong:** The embedded MCP server handles incoming tool calls (e.g., `publish_event`) asynchronously over stdio or HTTP. These handlers call into daemon methods that perform synchronous SQLite operations. If the MCP server processes multiple requests concurrently (e.g., two agents both call `publish_event` at the same time), both handlers enter the event loop concurrently and invoke synchronous SQLite writes on the shared `DatabaseSync` connection interleaved. SQLite's synchronous interface means the JS call stack serializes them, so correctness is maintained — but if any handler throws inside a `BEGIN` block and the `ROLLBACK` is not reached (e.g., due to an unhandled promise rejection), the database is left in a hung transaction.

**Why it happens:** The current codebase opens `BEGIN` / `COMMIT` / `ROLLBACK` manually. An unhandled rejection that bypasses the `ROLLBACK` in `publish-event.ts` or `adapter-worker.ts` leaves the connection in an open transaction, causing all subsequent queries to fail with "cannot start a transaction within a transaction."

**Consequences:**
- Daemon becomes unusable for all subsequent operations after a single MCP handler crashes mid-transaction
- Difficult to diagnose: error appears as "SQLITE_ERROR: cannot start a transaction" on unrelated operations

**Prevention:**
- Wrap all transaction boundaries in a helper that guarantees `ROLLBACK` on any throw (the existing `publish-event.ts` already does this, but validate every MCP-facing code path does too).
- The MCP server's async request handlers must be wrapped in a top-level try/catch that logs and returns an MCP error response without crashing the process.
- Consider using a lightweight transaction helper: `withTransaction(db, fn)` that always rolls back on error.

**Detection:** Inject a deliberate throw inside a transaction in an integration test and assert the database remains queryable afterward.

**Phase:** MCP Server phase.

---

### Pitfall 7: MCP Server Stdio Transport Conflicts with Daemon's own stdout/stderr Usage

**What goes wrong:** The MCP specification's stdio transport uses stdin/stdout as the communication channel between MCP client and server. If the daemon is run in daemon mode (i.e., as a background process), and the embedded MCP server uses stdio transport, any `console.log` or `process.stdout.write` call from the daemon (including from structured logging) will corrupt the MCP message framing. MCP over stdio uses newline-delimited JSON; any non-JSON line from the daemon will cause the MCP client to fail to parse the stream.

**Why it happens:** stdio is a single stream shared by the process. MCP stdio assumes exclusive ownership of stdout. Daemon logging to stdout breaks this assumption.

**Consequences:**
- MCP client disconnects or throws parse errors on every log line emitted
- Daemon becomes non-functional as an MCP server when structured logging writes to stdout

**Prevention:**
- If using stdio transport: redirect ALL daemon logging to stderr or to file. Never allow stdout writes except through the MCP transport layer.
- Prefer HTTP/SSE transport (listening on a local port) for the embedded MCP server if the daemon also needs stdout for other purposes (e.g., CLI mode).
- Decide the transport strategy early — it affects the entire logging architecture.

**Detection:** Start the MCP server with a test client and emit a single log line to stdout. The client will receive a parse error.

**Phase:** MCP Server phase — transport choice must be decided before structured logging is implemented.

---

## Moderate Pitfalls

---

### Pitfall 8: Recovery Scan Firing While Multiple Workers Are Mid-Claim

**What goes wrong:** With concurrent workers, multiple workers call `claimNextDelivery` in the same event loop tick. The claim query uses `SELECT ... LIMIT 1` followed by an UPDATE — all inside a BEGIN/COMMIT. Because `DatabaseSync` is synchronous and the event loop is single-threaded, these calls actually serialize correctly. However, if recovery-scan fires (via `setInterval`) at the same time as several workers are mid-claim, the recovery-scan's `reclaimExpiredLeases` could incorrectly reclaim a lease that was just granted but not yet reflected in its SELECT (if the SELECT and UPDATE race across a timer callback boundary).

**Why it happens:** `setInterval` callbacks and async continuations share the event loop. A delivery claimed by a worker but not yet committed when the recovery-scan SELECT runs can appear expired (old `lease_expires_at` still present in the row until the UPDATE commits).

**Prevention:**
- The existing claim logic already handles this: the UPDATE's WHERE clause requires `status IN ('ready', 'retry_scheduled') AND available_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`. A just-claimed row has status `leased`, so the recovery scan's SELECT won't touch it.
- This is safe by design, but document it explicitly so concurrent workers implementation doesn't break the invariant by changing the claim logic.

**Detection:** Add concurrent worker tests that run workers and recovery-scan simultaneously; assert no delivery is double-claimed.

**Phase:** Concurrent Workers phase.

---

### Pitfall 9: Structured Logger Becomes a Synchronous Bottleneck

**What goes wrong:** Structured loggers that write to files synchronously (using `fs.writeFileSync` or equivalent) block the event loop on each log call. In a high-throughput scenario (many workers logging process start/complete events), this serializes the entire daemon on disk I/O.

**Why it happens:** Synchronous file writes are the simplest logging implementation. `DatabaseSync` already blocks on SQLite operations; adding blocking log writes compounds the latency.

**Prevention:**
- Use async or buffered log writes. Node.js streams (`fs.createWriteStream`) with a writable buffer are the right primitive — already used for per-run log files in `process-runner.ts`.
- Daemon-level structured logging should write to `process.stderr` (async) or a dedicated async write stream, not `fs.writeFileSync`.
- Separate per-run log files (already file-per-process) from daemon-level structured logs (single stream for all daemon events).

**Phase:** Structured Logging phase.

---

### Pitfall 10: Env Isolation Breaking Adapter Executables That Rely on PATH

**What goes wrong:** When env isolation strips `process.env` and rebuilds from a clean base, `PATH` may not contain the directories needed to locate `gemini`, `codex`, or `opencode`. The spawn call resolves the command via `PATH`, so a stripped `PATH` causes `ENOENT` on the child process, which is silently handled as a process error and retried until dead-letter.

**Why it happens:** `PATH` is a system-level variable, not an application variable, but it's part of `process.env`. An allowlist that doesn't explicitly carry `PATH` through will break executable resolution.

**Consequences:**
- All agent spawns fail with `ENOENT` after env isolation is enabled
- Manifests as dead-lettered deliveries with error "spawn gemini ENOENT"
- Easy to miss in local testing if the developer's PATH is always correct

**Prevention:**
- `PATH` must be in the minimum required passthrough set, not optional.
- After implementing env isolation, run a basic spawn test that verifies the adapter executable resolves correctly.
- Consider resolving executable paths to absolute paths at daemon startup (using `which`/`which-sync`) and passing absolute paths to `spawn`, eliminating PATH dependency at runtime.

**Phase:** Env Isolation phase.

---

### Pitfall 11: Concurrent Workers Claiming the Same Delivery (False Concurrency Safety)

**What goes wrong:** With concurrent workers implemented as multiple calls to `claimNextDelivery` in the same Node.js process, correctness relies on the SELECT + UPDATE being atomic within the transaction. This is safe for synchronous `DatabaseSync` in a single process. However, if a future implementation uses separate Node.js `Worker` threads or separate processes each with their own `DatabaseSync` connection to the same SQLite file, the SELECT-then-UPDATE claim pattern is a TOCTOU race: two workers SELECT the same row (both see it as claimable), both attempt to UPDATE it, and SQLite's row-level locking allows only one to succeed — but only if the UPDATE includes a sufficiently specific WHERE clause.

**Why it happens:** The current `claimDelivery` UPDATE includes `AND status IN ('ready', 'retry_scheduled')` which means only one UPDATE will find the row in the right state after the first succeeds and changes it to `leased`. This is correct. But any change that relaxes this WHERE clause or adds an intermediate step breaks the pattern.

**Prevention:**
- Document that the atomic claim relies on the UPDATE's status constraint. Never add a separate status-check step before the UPDATE.
- If true multi-process or multi-thread concurrency is ever added, test concurrent claims explicitly with SQLite's WAL mode.

**Phase:** Concurrent Workers phase — understand before implementing.

---

## Minor Pitfalls

---

### Pitfall 12: Log File Accumulation Without Retention Policy

**What goes wrong:** Each delivery attempt creates a new log file at `logs/adapter-runs/{deliveryId}-attempt-{N}.log`. With multiple workers processing many deliveries, log files accumulate indefinitely. On a developer's local machine running long-lived workflows, the logs directory can grow to gigabytes.

**Prevention:**
- Add a log retention policy (e.g., keep last N runs, or delete files older than X days) as part of the structured logging phase.
- At minimum, document that log cleanup is manual.

**Phase:** Structured Logging phase (natural time to address).

---

### Pitfall 13: MCP Tool Schema Drift from Daemon API

**What goes wrong:** MCP tool definitions (`publish_event`, `get_delivery`, `list_artifacts`) must match the daemon's actual API contracts. If the daemon's event envelope schema or delivery structure changes (e.g., in a future v1.x), the MCP tool schemas drift silently — agents calling `publish_event` get no type error, just a runtime failure when the daemon rejects the payload.

**Prevention:**
- Derive MCP tool input schemas from the same Zod schemas used for manifest and envelope validation (they already exist in `src/domain/` and `src/config/manifest-schema.ts`).
- Add a test that validates MCP tool call payloads against the live Zod schemas.

**Phase:** MCP Server phase.

---

### Pitfall 14: `stopped` Flag in daemon `stop()` Does Not Drain In-Flight Workers

**What goes wrong:** The current `stop()` in `daemon/index.ts` sets `stopped = true`, stops the recovery scan, and closes the database. If workers are mid-iteration (running a child process), the database is closed while they may still be trying to write results. `DatabaseSync` operations after `close()` throw synchronously, which may be swallowed in an async context and leave deliveries stuck in `leased` with no further handling.

**Prevention:**
- When adding concurrent workers, implement a graceful drain: stop accepting new claims, wait for all in-flight `runIteration` promises to settle, then close the database.
- Track active worker promises in a `Set<Promise>` and `await Promise.allSettled(activeWorkers)` before `database.close()`.

**Phase:** Concurrent Workers phase — stop must be made drain-aware simultaneously with adding concurrency.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Process Timeouts | SIGTERM not killing subprocess tree (grandchildren survive) | Kill process group with `-child.pid`; add SIGKILL fallback |
| Process Timeouts | Lease shorter than timeout causes double execution | Validate `leaseDurationMs > timeoutMs + graceMs` at startup |
| Structured Logging | Test suite breakage from format change | Audit string assertions before implementation; inject transport in tests |
| Structured Logging | Stdout corruption of MCP stdio transport | Decide transport (stdio vs HTTP) before logging architecture |
| Structured Logging | Synchronous writes blocking event loop | Use async streams, not `writeFileSync` |
| Concurrent Workers | `stop()` closes DB while workers are mid-flight | Drain in-flight promises before `database.close()` |
| Concurrent Workers | Recovery-scan / worker lease interaction | Existing WHERE clause is safe; do not relax it |
| Env Isolation | PATH stripped, executables not found | PATH is mandatory passthrough; resolve to absolute paths at startup |
| Env Isolation | Daemon secrets leaking to children | Allowlist (not denylist) approach; test with poisoned env |
| MCP Server | Hung transaction after unhandled rejection in handler | `withTransaction` helper guaranteeing ROLLBACK; top-level catch in handlers |
| MCP Server | stdio transport incompatible with logging to stdout | Use stderr or HTTP transport; decide before logging phase |
| MCP Server | Tool schemas drift from domain types | Derive from existing Zod schemas; validate with tests |

---

## Sources

- Codebase analysis: `src/adapters/process-runner.ts`, `src/daemon/adapter-worker.ts`, `src/daemon/delivery-service.ts`, `src/storage/delivery-store.ts`, `src/storage/sqlite-client.ts`, `src/daemon/index.ts`, `src/daemon/recovery-scan.ts`, `src/adapters/registry.ts` — HIGH confidence (direct read)
- Node.js `child_process.spawn` documentation on process groups and signal delivery — HIGH confidence (well-documented platform behavior)
- SQLite WAL mode write serialization and `busy_timeout` scope — HIGH confidence (SQLite official documentation)
- MCP stdio transport specification exclusivity of stdout — MEDIUM confidence (protocol specification, embedding patterns less documented)
- Node.js `DatabaseSync` thread-safety — HIGH confidence (experimental API docs clearly state single-thread use)
