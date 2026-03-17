# Domain Pitfalls

**Domain:** Node.js CLI daemon — adding SDK/library mode, event schema registry, web dashboard, and plugin adapter system to existing SQLite + pino + MCP runtime
**Researched:** 2026-03-17
**Confidence:** HIGH for SDK/library mode and plugin loading (Node.js platform behavior, direct codebase analysis); MEDIUM for schema registry design (pattern-derived, no public record of this exact use case); MEDIUM for web dashboard co-location (Node.js HTTP patterns, SSE)

---

## Critical Pitfalls

Mistakes that cause data corruption, broken tests, security holes, or require rewrites.

---

### Pitfall 1: SDK Mode Registers `process.once("SIGINT/SIGTERM")` — Host Process Owns Shutdown, Not the Library

**What goes wrong:** `daemon/index.ts` line 131 registers `process.once("SIGINT", handleSignal)` and `process.once("SIGTERM", handleSignal)` unconditionally when `registerSignalHandlers !== false`. When Agent Bus is embedded as an SDK library inside a test runner, a CI harness, or another Node.js application, the host already owns shutdown. The daemon's signal handlers fire and call `database.close()` before the host's cleanup runs. In Jest/Vitest environments the signal handler causes the process to exit during test teardown, killing the test runner mid-suite.

**Why it happens:** The `startDaemon()` function was designed as a CLI entry point where signal ownership is obvious. The `registerSignalHandlers` option exists but defaults to `true`, so any caller that doesn't know to pass `false` gets the handlers.

**Consequences:**
- Embedded SDK inside tests fires `stop()` on SIGINT, closing the database while tests are mid-transaction
- Host application's graceful shutdown (Express `server.close()`, Prisma `$disconnect()`) runs after database is already closed
- `DatabaseSync` calls after `close()` throw synchronously in async contexts, producing silent delivery corruption
- Duplicated signal listeners accumulate if `startDaemon()` is called multiple times (e.g., in test beforeEach)

**Prevention:**
- Default `registerSignalHandlers` to `false` in SDK mode. Add a separate `createDaemonForProcess()` factory that wraps `startDaemon` with `registerSignalHandlers: true` for CLI use only.
- Document in the SDK entry point: callers are responsible for calling `daemon.stop()` in their own shutdown handlers.
- Add a test that starts and stops the daemon twice in the same process to detect handler accumulation.

**Detection:** Warning sign: Jest exits with "A worker process has failed to exit gracefully" or test timeout on teardown. Also: `process.listenerCount("SIGINT") > 1` after multiple `startDaemon()` calls.

**Phase:** SDK/library mode — first thing to address when exposing `startDaemon` as a public API.

---

### Pitfall 2: SDK Mode Exposes Internal Mutation Methods Without a Stable Public Contract

**What goes wrong:** The `AgentBusDaemon` interface in `daemon/index.ts` exposes raw store operations — `claimDelivery`, `acknowledgeDelivery`, `failDelivery`, `replayDelivery`, `replayEvent` — which are currently used only by the CLI and internal tests. When these become a public SDK API, any future refactor of `deliveryService` or `deliveryStore` that renames a field (e.g., `leaseToken` → `lease_token`) is a breaking change for SDK consumers. The type definitions leak internal implementation types (`PersistedDeliveryRecord`, store-derived return types via `ReturnType<...>`) rather than stable public shapes.

**Why it happens:** The `AgentBusDaemon` interface was designed for internal composition, not external consumption. The return type of `publish()` is computed via a conditional `ReturnType<...>` chain — functionally correct but fragile to refactoring.

**Consequences:**
- Any store-level schema change (adding a column, renaming a field) breaks every SDK consumer silently at the TypeScript level or at runtime
- SDK consumers need to import internal types (`PersistedDeliveryRecord`) for type safety, creating tight coupling
- No deprecation path exists: once internal types are in consumers' code, removing them is a breaking change

**Prevention:**
- Define a separate `src/sdk/types.ts` with stable public types (`DeliveryRecord`, `RunSummary`, etc.) that are independent of storage layer types
- Map internal types to public types at the `startDaemon` boundary — never leak `PersistedDeliveryRecord` or `ReturnTypeOf*` to SDK consumers
- Treat `AgentBusDaemon` as a public API surface: every method's return type must be a named, stable type
- Add a lint rule or type test that prevents `src/storage/` types from appearing in `src/sdk/` exports

**Detection:** Any `import` of `PersistedDeliveryRecord` outside `src/storage/` and `src/daemon/` in SDK-facing files.

**Phase:** SDK/library mode — architecture decision before writing any SDK entry point.

---

### Pitfall 3: Schema Registry Validation Rejects Valid Events from Agents That Don't Know the Schema Exists

**What goes wrong:** The schema registry validates `payload` against a registered schema when publishing an event. Existing agents — built before schema validation was added — emit `payload` objects that may include extra fields, use looser types, or omit optional fields. If the schema registry applies strict validation (no extra keys, all fields required), every existing agent breaks on first publish after the registry is enabled. The failure manifests as a dead-lettered delivery with a Zod validation error, not a helpful schema mismatch message.

**Why it happens:** Adding validation to an existing unvalidated pipeline is a breaking change. Zod defaults (`z.object({})` without `.passthrough()`) strip unrecognized keys but do not reject them. However, `.parse()` with `.strict()` rejects them, and even lenient schemas will fail if the agent emits a field with the wrong type.

**Consequences:**
- All existing agents dead-letter their first delivery after the registry is enabled
- Developers cannot distinguish "agent wrote bad payload" from "schema is wrong" without reading the error
- Registry rollout blocks entire workflow until every agent is updated

**Prevention:**
- Introduce schema validation in **warn** mode first: log a structured warning (`level: warn, event: schema.mismatch`) but allow the publish to proceed. Gate strict enforcement behind an explicit per-topic opt-in flag in the manifest (e.g., `schemaEnforcement: "warn" | "reject"`).
- Use `.passthrough()` on all registry schemas by default (extra keys allowed); only reject missing required fields and wrong types.
- Write a migration script that scans existing event records in SQLite and validates them against candidate schemas before enabling enforcement.

**Detection:** Run `npm test` with schema enforcement enabled and observe dead-letter rate. If > 0 with existing fixtures, the registry is too strict.

**Phase:** Event schema registry — enforcement strategy must be decided before first schema is registered.

---

### Pitfall 4: Plugin Adapter Loading via Dynamic `import()` Shares the ESM Module Cache

**What goes wrong:** The plugin system loads adapters via dynamic `import(pluginPath)`. Node.js ESM module cache is keyed by resolved URL and is permanent for the lifetime of the process — there is no public API to invalidate or evict a module. This means:
1. A plugin loaded once cannot be reloaded (e.g., after hot-swap during development)
2. Two plugins at different paths that resolve to the same canonical URL are the same module instance
3. If a plugin import fails mid-way (e.g., top-level await throws), the cache entry is left in an error state and subsequent imports of the same path also fail without a useful error

**Why it happens:** ESM caching is a platform invariant, not a configuration choice. Dynamic `import()` does not bypass the cache.

**Consequences:**
- Plugin reload without process restart is not possible in pure ESM — a common expectation for plugin systems
- A buggy plugin that throws during module initialization poisons the cache for the entire daemon lifetime
- Tests that load different plugin configurations in the same Jest/Vitest process see stale cached modules

**Prevention:**
- Document explicitly: plugins are loaded once per process lifetime; daemon restart is required to reload a plugin.
- Validate plugin path resolution before `import()` — check that the file exists with `fs.access()` and emit a structured error before the import attempt fails with a confusing module-not-found error.
- Wrap `import()` in a try/catch that captures the full error and includes the plugin path in the message: `Failed to load plugin at ${pluginPath}: ${error.message}`.
- For tests, instantiate plugin adapters directly (pass the builder function) rather than loading via dynamic import to avoid cache state leaking between tests.

**Detection:** Load the same plugin twice in a test with a modified export; assert the second load returns the updated version. It won't — confirms cache is permanent.

**Phase:** Plugin adapter system — document the constraint before implementation to prevent a design that promises hot-reload.

---

### Pitfall 5: Web Dashboard HTTP Server Port Conflicts with MCP HTTP Server

**What goes wrong:** The daemon already runs an MCP HTTP server on a dynamic port (bound to `127.0.0.1`). Adding a web dashboard HTTP server introduces a second `http.createServer()` in `startDaemon()`. If both servers are started sequentially without error handling between them, an `EADDRINUSE` on the dashboard port causes the MCP server to already be running — `stop()` must be called on it before re-throwing, or the port is leaked. If the existing MCP server's port happens to match the configured dashboard port (unlikely but possible when a fixed port is configured), the bind fails silently or with a confusing error.

**Why it happens:** Two independent `http.createServer()` calls in the same startup sequence create a partial-startup failure mode that is easy to overlook. The existing MCP startup already has a cleanup guard (`database.close()` on failure) but it does not follow through to MCP stop.

**Consequences:**
- Daemon startup fails with `EADDRINUSE` but MCP server is already listening — daemon appears to have started (port is occupied) but is non-functional
- If startup is retried (e.g., by PM2), the port stays occupied because the first MCP server was never stopped
- Dashboard on a fixed port conflicts with MCP on `--mcp-port [same]` — both fail, neither with a clear error

**Prevention:**
- Start both servers in parallel (`Promise.all`), then clean up both on any failure.
- Add explicit port conflict detection: if dashboard port = MCP port, fail fast at validation before any server starts.
- Follow the existing pattern in `daemon/index.ts`: wrap all server startups in try/catch, call `stop()` on already-started servers before re-throwing.
- Use port 0 (ephemeral) as the default for both servers; only fixed ports require explicit configuration and conflict checking.

**Detection:** In startup code, add a test that simulates `EADDRINUSE` on the dashboard server after MCP has started; assert MCP is also stopped.

**Phase:** Web dashboard — port management and startup cleanup reviewed before first HTTP server implementation.

---

### Pitfall 6: Web Dashboard Creates a Second `DatabaseSync` Read Connection — WAL Mode Required

**What goes wrong:** The web dashboard serves read-only queries (list runs, get delivery state, list approvals) concurrently with the daemon's write operations. If the dashboard uses the same shared `DatabaseSync` connection as the daemon, every dashboard read serializes with every daemon write on the JS event loop — acceptable for low traffic but creates event loop head-of-line blocking on slow dashboard queries (e.g., a full run history scan). If the dashboard opens a second connection to the same SQLite file without WAL mode, write operations block all reads until the write transaction commits.

**Why it happens:** `node:sqlite` `DatabaseSync` is synchronous and single-connection. The existing daemon uses WAL mode (`PRAGMA journal_mode = WAL`), which does allow concurrent readers with a single writer — but only if readers open their own connection.

**Consequences:**
- Dashboard reads block daemon write throughput on the shared connection
- Without WAL, a second reader connection gets `SQLITE_LOCKED` during any daemon transaction
- Developer sees "dashboard hangs during high delivery load" — hard to diagnose without understanding WAL

**Prevention:**
- The dashboard must open a read-only connection: `new DatabaseSync(dbPath, { open: true })` with `PRAGMA query_only = ON` set immediately.
- Confirm WAL mode is already set before opening the read connection (the daemon's `openSqliteDatabase` already sets WAL — verify with `PRAGMA journal_mode`).
- Never share the daemon's write connection with the dashboard's request handlers.
- Add a comment at the dashboard connection point explaining the WAL dependency.

**Detection:** Run a dashboard query while the daemon is inside a long transaction; time the query. Should not block if WAL is active and connections are separate.

**Phase:** Web dashboard — connection strategy reviewed before any dashboard SQL is written.

---

## Moderate Pitfalls

---

### Pitfall 7: SDK Mode — `stop()` Does Not Wait for In-Flight Worker Iterations

**What goes wrong:** The current `stop()` in `daemon/index.ts` (line 249) calls `recoveryScan.stop()`, `mcpServer.stop()`, and `database.close()` synchronously in sequence. It does not wait for any in-flight `runWorkerIteration` promises. In SDK mode, the caller may call `daemon.stop()` while a worker is mid-delivery (spawned process running). The database is closed while the worker is about to write the delivery result, causing a `DatabaseSync` throw that is swallowed in the async iteration context. The delivery is left in `leased` state with no owner — recovery scan will fix it on next start, but it appears as a spurious retry.

**Why it happens:** Graceful drain was identified as a pitfall in the v1.1 PITFALLS.md (Pitfall 14) but deferred. In CLI mode, SIGTERM to the daemon kills the whole process anyway. In SDK mode, `stop()` is called programmatically and the caller may await it and then proceed with other cleanup — they expect a clean stop.

**Prevention:**
- `stop()` must await `adapterWorker.drainInFlight()` before `database.close()`. Track active `runIteration` promises in a `Set<Promise>` and `await Promise.allSettled(...)` before closing.
- Add a `drainTimeoutMs` option: if workers don't finish within N seconds, `forceKillInFlight()` and then close.
- This is the same fix needed for the existing CLI daemon — SDK mode makes it urgent because the caller awaits `stop()`.

**Detection:** Start an iteration, call `stop()` immediately, assert the delivery is in `completed` or `retry_scheduled` state (not `leased`) after stop resolves.

**Phase:** SDK/library mode — must ship with `stop()` drain before the SDK is usable in tests.

---

### Pitfall 8: Schema Registry — Zod Schema Defined in Manifest YAML Cannot Express Nested Object Types

**What goes wrong:** The manifest YAML schema (`manifest-schema.ts`) is loaded with Zod. If the schema registry stores per-topic payload schemas as YAML snippets or JSON Schema strings inside the manifest, parsing arbitrary user-defined JSON Schema at runtime requires a JSON Schema → Zod conversion layer (e.g., `zod-from-json-schema`) or a separate JSON Schema validator (e.g., Ajv). Using pure Zod for user-defined schemas requires distributing Zod schema definitions as TypeScript, which breaks the "declarative YAML manifest" model.

**Why it happens:** Zod schemas are TypeScript code, not data. The manifest is data (YAML). These two representations are not directly interchangeable. Projects often resolve this by storing JSON Schema in the manifest (data-compatible) and converting it to Zod at load time — but the conversion libraries are imperfect (union types, refinements, and custom validators don't convert cleanly).

**Consequences:**
- If JSON Schema is chosen: conversion gaps mean some valid JSON Schemas silently pass validation they should fail
- If Zod-as-code is chosen: schemas must be TypeScript files, not YAML — manifest loses its "single-file declarative" character
- Mixed approach (YAML for simple schemas, TypeScript for complex) creates two validation paths to maintain

**Prevention:**
- Choose JSON Schema (Ajv) for user-defined payload schemas — it is data-native, YAML-embeddable, and Ajv is the standard. Do not convert JSON Schema to Zod at runtime.
- Keep Zod exclusively for internal envelope and manifest validation — do not expose Zod schemas to plugin/user-defined schemas.
- Start with a minimal schema format: only `required`, `properties`, and `type` keywords. Document that complex validation (unions, custom refinements) requires a plugin validator.

**Detection:** Write a JSON Schema with a `$ref` or `oneOf` and attempt to validate an event payload; assert the validation result matches expected behavior before committing to the Ajv integration.

**Phase:** Event schema registry — schema format decision (JSON Schema vs Zod vs custom) before implementation.

---

### Pitfall 9: Plugin Adapters That Call `process.exit()` or Register Global Signal Handlers

**What goes wrong:** Third-party or user-written adapter plugins that call `process.exit()` on fatal errors, or that register their own `process.on("SIGTERM")` handlers, directly conflict with the daemon's lifecycle. An adapter plugin that calls `process.exit(1)` kills the entire daemon, including any other in-flight deliveries, the MCP server, and the database connection — without triggering `stop()` cleanup. Result: database left open mid-transaction, leased deliveries stuck permanently.

**Why it happens:** Plugin authors used to writing CLI tools or standalone scripts use `process.exit()` idiomatically for error handling. The plugin contract does not currently prohibit it because the adapter system uses process spawning (not in-process module loading) — but the plugin system loads adapter builders in-process.

**Consequences:**
- Any plugin that calls `process.exit()` during initialization (before any delivery is processed) crashes the daemon with no log output
- Plugins that call `process.exit()` on their first delivery dead-letter every delivery they handle
- Global signal handler accumulation: each `startDaemon()` + plugin load pair adds another handler to `process` event emitter

**Prevention:**
- Define the plugin contract explicitly: plugins MUST NOT call `process.exit()`, register global signal/uncaughtException handlers, or call `process.on(...)`. Document this in the plugin API surface.
- Add a test that loads a plugin stub that calls `process.exit()` and asserts the daemon catches and rejects it (using `process.mockExit` in tests).
- Consider loading plugins inside a sandboxed `vm.runInNewContext()` for initialization validation, if only to detect global mutations during startup.

**Detection:** After loading a plugin, assert `process.listenerCount("SIGTERM")` has not increased beyond the expected count.

**Phase:** Plugin adapter system — contract enforcement before any plugin is accepted.

---

### Pitfall 10: Web Dashboard SSE Stream Left Open During Daemon `stop()`

**What goes wrong:** The web dashboard uses Server-Sent Events (SSE) to push delivery state updates to the browser. SSE connections are long-lived — the client holds an HTTP response open for minutes. When `daemon.stop()` is called, the `httpServer.close()` call stops accepting new connections but does not destroy existing keep-alive or SSE connections. Node.js `http.Server.close()` only resolves the callback after all connections are closed — if SSE clients are connected, `close()` hangs indefinitely.

**Why it happens:** `http.Server.close()` is documented to not forcefully terminate existing connections. SSE connections are persistent HTTP responses that keep the socket open until the client disconnects. This is the same pattern that causes Express servers to hang on graceful shutdown.

**Consequences:**
- `daemon.stop()` never resolves as long as a browser tab has the dashboard open
- In SDK/test mode, test teardown hangs waiting for stop to complete
- CI runs timeout waiting for daemon stop if a test opened a dashboard connection

**Prevention:**
- Use `server.closeAllConnections()` (Node.js 18.2+) before `server.close()` to forcefully terminate SSE connections during shutdown.
- Alternatively, track active SSE response objects and call `res.end()` on all of them before calling `server.close()`.
- Add a shutdown timeout: if `server.close()` does not resolve within 3 seconds, call `server.closeAllConnections()` as a fallback.
- Test: start daemon with dashboard, open an SSE connection, call `stop()`, assert it resolves within 5 seconds.

**Detection:** `daemon.stop()` hangs in test teardown after opening any dashboard SSE endpoint.

**Phase:** Web dashboard — shutdown integration must be tested before dashboard is used in any test suite.

---

### Pitfall 11: Plugin Adapter Registry Hardcodes `SupportedRuntimeFamily` Enum — Plugin System Breaks the Closed Enum

**What goes wrong:** `adapters/registry.ts` exports `SupportedRuntimeFamilySchema = z.enum(["codex", "open-code", "gemini", "claude-code"])`. The adapter worker calls `getRuntimeDefinition(input.agent.runtime)` to look up the builder. With a plugin system, user-defined runtimes (e.g., `"my-custom-agent"`) will not be in this enum. The manifest schema validates `runtime: z.string().min(1)` (not the enum), so a plugin runtime passes manifest loading — but `getRuntimeDefinition()` returns `null` and `buildAdapterCommand()` falls through to `buildGenericManifestCommand()`. This silently bypasses all vendor-specific command construction for user plugins that need custom logic.

**Why it happens:** The enum was added to enumerate known vendors. The fallback to `buildGenericManifestCommand` was added for forward compatibility but predates the plugin system. A plugin that needs to inject custom args (like `--headless`, identity files, or model selectors) cannot do so via the generic path.

**Consequences:**
- Plugins that need custom command building silently fall back to the generic path — no error, just wrong behavior
- Plugin authors cannot tell whether their plugin's `buildCommand()` function was called
- The closed `SupportedRuntimeFamilySchema` enum is exported as part of the adapter API — adding plugin runtimes to it is impossible without modifying the source

**Prevention:**
- Replace the closed enum with an open registry: `Map<string, RuntimeDefinition & { buildCommand: BuildAdapterCommandFn }>`.
- Plugin registration: `registerAdapter(family: string, definition: RuntimeDefinition)`.
- Remove `SupportedRuntimeFamilySchema` from the public API surface — it is now an internal detail of built-in adapters.
- Add a test that registers a plugin adapter and asserts its `buildCommand` is called (not the generic fallback).

**Detection:** Register a plugin adapter that adds a custom arg; inspect the spawned command and assert the arg is present. If not present, the generic path was used.

**Phase:** Plugin adapter system — registry refactor before plugin loading is implemented.

---

## Minor Pitfalls

---

### Pitfall 12: Schema Registry Adds Per-Event Validation Cost to the Publish Hot Path

**What goes wrong:** `publish-event.ts` persists events inside a `BEGIN/COMMIT` transaction. Adding schema validation inside this transaction means Zod/Ajv runs synchronously while the transaction is open. For events with large payloads (e.g., a 50KB JSON payload from a code agent), Ajv schema compilation and validation adds measurable latency inside the write lock.

**Prevention:**
- Validate the event payload before entering the transaction. Schema validation should be a pre-transaction step.
- Compile Ajv schemas once at daemon startup (per topic, per schema version) and cache the compiled validator. Never compile a schema per event.
- Add a benchmark test: publish 100 events with schema validation enabled and assert mean latency per publish is within an acceptable bound.

**Phase:** Event schema registry — validation placement must be pre-transaction.

---

### Pitfall 13: SDK Module Dual-Instance from `require` vs `import` in Test Environments

**What goes wrong:** If Agent Bus is published as an npm package with both CJS and ESM entry points (via `exports` field), a test runner that mixes `require()` and `import()` may load two instances of the same module. Two instances means two `DatabaseSync` connections to the same SQLite file, two sets of state, and confusing test failures where published events are not visible to the query-side instance.

**Prevention:**
- Publish ESM-only (`"type": "module"` in `package.json`). Do not add a CJS entry point unless there is an explicit consumer requirement.
- If CJS is required, use a single CJS wrapper that re-exports the ESM default and document the dual-instance risk.
- Add a test that imports the package from two different paths (`../../src/daemon/index.js` and `../../src/index.js`) and asserts they return the same reference.

**Phase:** SDK/library mode — module export strategy decided before publishing.

---

### Pitfall 14: Web Dashboard Reads SQLite While Recovery Scan Runs — Stale Read Risk

**What goes wrong:** The dashboard's read connection may see a stale view of delivery state during the brief window when the recovery scan is running its `reclaimExpiredLeases` UPDATE. SQLite WAL mode guarantees snapshot isolation per connection — the dashboard's read transaction sees a consistent snapshot of the moment the read began, not mid-update state. This is correct behavior, but developers may misinterpret "dashboard shows delivery as leased even though it was just retried" as a bug.

**Prevention:**
- Document that dashboard state reflects SQLite WAL snapshot isolation: reads are consistent but may lag writes by one event-loop cycle.
- Add a "last updated" timestamp to dashboard responses so the operator knows the data freshness.
- Do not attempt to work around WAL snapshot isolation by sharing the write connection — this is the correct behavior.

**Phase:** Web dashboard — document the behavior, not a bug to fix.

---

### Pitfall 15: Plugin Manifests Can Declare Arbitrary `runtime` Values That Pass Zod But Crash the Worker

**What goes wrong:** The manifest schema allows `runtime: z.string().min(1)` — any non-empty string is valid. A plugin manifest that declares `runtime: "my-plugin"` passes manifest loading. If the plugin adapter for `"my-plugin"` is not registered (e.g., the plugin file is missing or failed to load), `buildAdapterCommand()` falls through to `buildGenericManifestCommand()`, which uses `agent.command` as-is. If `command` is also wrong (e.g., `["my-plugin-cli", "--task"]` and `my-plugin-cli` is not installed), the spawn fails with `ENOENT`, which dead-letters the delivery with a cryptic error.

**Prevention:**
- At daemon startup (after plugins are loaded), validate that every `runtime` value in the manifest has a registered adapter. Fail fast with a clear error: `No adapter registered for runtime "my-plugin". Did you forget to load the plugin?`
- This check already partially exists: `assertSupportedRuntimeFamily` throws for unknown runtimes, but only if the runtime is not in the closed enum. With the open registry (Pitfall 11 fix), this check becomes natural.

**Phase:** Plugin adapter system — startup validation added alongside registry.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| SDK/library mode | Signal handler registration in the host process | Default `registerSignalHandlers: false`; document host owns shutdown |
| SDK/library mode | Internal storage types leaked as public API | Define `src/sdk/types.ts` with stable public shapes; map at boundary |
| SDK/library mode | `stop()` does not drain in-flight workers | Await `Promise.allSettled(activeWorkers)` before `database.close()` |
| SDK/library mode | Dual-instance from CJS/ESM mixing in tests | ESM-only publish; no CJS entry point |
| Event schema registry | Strict validation rejects existing agents on rollout | Warn mode first; strict opt-in per topic; `.passthrough()` default |
| Event schema registry | JSON Schema vs Zod format decision | JSON Schema + Ajv for user schemas; Zod only for internal validation |
| Event schema registry | Validation inside transaction adds write latency | Validate before `BEGIN`; compile validators once at startup |
| Web dashboard | Second HTTP server port conflict with MCP server | `Promise.all` startup; fail fast on port == mcpPort; cleanup both on failure |
| Web dashboard | Dashboard uses shared write connection | Read-only connection with `PRAGMA query_only = ON`; confirm WAL active |
| Web dashboard | SSE connections prevent `stop()` from resolving | `server.closeAllConnections()` before `server.close()` |
| Plugin adapter system | ESM module cache: plugins cannot be hot-reloaded | Document: restart required; validate path before `import()` |
| Plugin adapter system | Plugins call `process.exit()` or register signal handlers | Explicit plugin contract prohibition; test with mock exit |
| Plugin adapter system | Closed `SupportedRuntimeFamilySchema` enum blocks plugin runtimes | Replace with open `Map`-based registry |
| Plugin adapter system | Plugin runtime not registered causes silent generic fallback | Startup validation: every manifest `runtime` must have a registered adapter |

---

## Sources

- Codebase analysis (direct read): `src/daemon/index.ts`, `src/daemon/adapter-worker.ts`, `src/adapters/registry.ts`, `src/adapters/contract.ts`, `src/daemon/mcp-server.ts`, `src/config/manifest-schema.ts`, `src/domain/event-envelope.ts` — HIGH confidence
- Node.js ESM module cache behavior: [Node.js ESM documentation](https://nodejs.org/api/esm.html) — HIGH confidence (platform invariant)
- Node.js `http.Server.close()` keep-alive connection behavior: Node.js HTTP documentation and [Socket.IO EADDRINUSE handling](https://socket.io/how-to/handle-eaddrinused-errors) — HIGH confidence (documented platform behavior)
- `server.closeAllConnections()` API (Node.js 18.2+): Node.js HTTP docs — HIGH confidence
- Signal handler SDK pitfall precedent: [SIGINT/SIGTERM handlers prevent graceful shutdown — openai-agents-js issue #175](https://github.com/openai/openai-agents-js/issues/175) — MEDIUM confidence (specific library, generalizable pattern)
- Schema registry enforcement modes: [Confluent Schema Registry fundamentals](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html) and [Solace schema registry best practices](https://docs.solace.com/Schema-Registry/schema-registry-best-practices.htm) — MEDIUM confidence (distributed systems patterns, applied to local use case)
- JSON Schema vs Zod for user-defined schemas: [Event versioning strategies](https://theburningmonk.com/2025/04/event-versioning-strategies-for-event-driven-architectures/) — MEDIUM confidence (pattern-derived)
- SQLite WAL snapshot isolation behavior: SQLite official WAL documentation — HIGH confidence
