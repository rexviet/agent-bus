<!-- AUTO-GENERATED from .planning/research/FEATURES.md by scripts/sync-planning-to-gsd.mjs. source-sha256: d5e955ea758a17684b121068f0a572c9d7e0caad47f0ce2a63e0a886f3c95599. Edit the source file, not this projection. -->

# Feature Landscape

**Domain:** Agent Bus v1.2 — Developer Experience: SDK/library mode, event schema registry, web dashboard, plugin adapter system
**Researched:** 2026-03-17
**Confidence:** HIGH (codebase read + web research verified)

---

## Existing Foundation (Already Shipped — Do Not Re-Implement)

These are in v1.0–v1.1 and out of scope for v1.2:

| Existing Feature | Location |
|-----------------|----------|
| Event publish, fan-out, approval gates | `daemon/publish-event.ts`, `daemon/approval-service.ts` |
| Delivery state machine (lease/retry/dead-letter/replay) | `daemon/delivery-service.ts`, `daemon/adapter-worker.ts` |
| Process spawning, env isolation, timeout | `adapters/process-runner.ts` |
| Concurrent workers with graceful drain | `cli/worker-command.ts` |
| Structured pino logging with correlation fields | `daemon/logger.ts` |
| MCP server embedded in daemon (publish_event) | `daemon/mcp-server.ts` |
| Runtime adapters: Codex, Gemini, Open Code, Claude Code | `adapters/vendors/` |
| CLI operator tooling (runs, approvals, failures, replay) | `src/cli/` |
| YAML manifest config with Zod validation | `config/manifest-schema.ts` |
| `events` array in result envelope (deprecated path) | `adapters/contract.ts` |

---

## Table Stakes

Features users expect for a library/embeddable tool at this maturity level. Missing any of these makes v1.2 feel unfinished.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| **SDK/library mode: `startDaemon()` is the public API** | Any tool intended for programmatic embedding must have a stable, documented entrypoint that does not require spawning a subprocess; the daemon `index.ts` already exposes `startDaemon()` returning `AgentBusDaemon` — the gap is packaging, exports, and `AgentBusDaemon` surface completeness | Low–Medium | `daemon/index.ts` is mostly already the right shape; needs package.json `exports`, TypeScript declaration files, and explicit surface audit |
| **Plugin adapter: external runtime loaded by manifest** | The adapter registry hardcodes four runtimes in a `switch` statement; adding a fifth requires patching core; plugin support means the manifest can declare a `plugin: "./my-adapter.js"` and the registry dynamically loads it at daemon start | Medium | `adapters/registry.ts` — the `buildAdapterCommand` switch must become an open registry; `VendorAdapterCommandInput` interface in `claude-code.ts` is the right contract shape |
| **Event schema registry: `topic → Zod schema` mapping** | Payloads on `event.payload` are `Record<string, unknown>` with no validation; a schema registry lets the manifest (or SDK consumer) declare expected shapes per topic; mismatched payloads are caught at publish time rather than inside the agent process | Medium | `daemon/publish-event.ts` — validation would run before `eventStore.insertEvent`; `config/manifest-schema.ts` — new optional `schemas` section |
| **Deprecate `events` array in result envelope** | `MCP-03` shipped; the `events` field in `SuccessfulAdapterResultSchema` is now the legacy path; keeping it silently alongside MCP creates two competing patterns; v1.2 should warn on use and document removal target | Low | `adapters/contract.ts` — add deprecation warning on parse; `adapter-worker.ts` — log a structured warning when `events.length > 0` |

---

## Differentiators

Features that are not universally expected but high-value for the Agent Bus persona (solo developer, local-first, operator visibility).

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| **Web dashboard: local HTTP + static UI** | The structured pino logs are operator-readable via `jq` but not human-scannable; a browser UI showing run list, delivery status per run, approval queue, and failure queue turns the tool from a black box into something observable in real time; especially valuable during long multi-agent workflows | High | New dependency (Hono + `@hono/node-server` for serving static files + SSE); builds on `daemon/operator-service.ts` + `daemon/approval-service.ts` which already expose the query surface; dashboard server shares the daemon's in-memory DB connection |
| **SDK: programmatic publish + subscribe for test harnesses** | Test suites that need to exercise multi-agent workflows currently must invoke the CLI or run a real daemon process; if `startDaemon()` is importable as a library and has typed publish/subscribe methods, integration tests can spin up in-process, publish synthetic events, and assert on delivery state | Low (if SDK packaging is done) | Gate on SDK packaging; no new daemon logic needed — `AgentBusDaemon` interface already has `publish`, `claimDelivery`, `acknowledgeDelivery`, `listRunSummaries` |
| **Schema registry: inline Zod or JSON Schema in manifest** | Coupling schema definitions to the manifest file means they are version-controlled alongside workflow config, not scattered across agent codebases; a developer can see at a glance what shape `qa.review.requested` expects; Zod v4 registries (`z.registry<{description}>()`) are the right primitive | Medium | Zod already used throughout codebase (`manifest-schema.ts`, `adapters/contract.ts`); Zod v4 metadata/registry API (verified via zod.dev/metadata) maps cleanly to a `topicSchemas` map |
| **Plugin adapter: typed `AdapterPlugin` interface** | Downstream users of the SDK can implement a `buildCommand(input): PreparedAdapterCommand` function, export it as default, and declare `plugin: "./path.js"` in their agent manifest entry; no fork of agent-bus needed to support a new AI tool | Medium | `VendorAdapterCommandInput` already defines the right input shape; needs a re-export from the public package surface |

---

## Anti-Features

Features to explicitly NOT build in v1.2.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **npm-published package / semver release** | Out of scope for a local-first solo developer tool; publishing to npm adds CI, release automation, and compatibility matrix overhead | Use `npm link` or `file:` local paths for embedding; package.json `exports` is still worth adding for clean ESM subpath access |
| **Schema migration / compatibility checking** | Confluent-style backward-compatibility rules (FULL, BACKWARD, FORWARD) are Kafka-grade complexity; agent-bus payloads are internal to a single repo | Validate at publish time with current schema; if schema changes, operator updates both manifest and agent code |
| **Schema registry as a separate process / service** | A standalone schema registry service (like Confluent Schema Registry) introduces network overhead and a second process to manage | Keep schema definitions in the manifest YAML or an inline TypeScript config file; use Zod parse at publish time |
| **WebSocket real-time push for dashboard** | SSE (server-sent events) is sufficient for one-directional updates (delivery state changes, new runs); WebSocket adds bidirectional complexity for no benefit | Hono `streamSSE` sends delivery lifecycle events to browser; browser polls or reconnects on SSE close |
| **Dashboard authentication / multi-user access** | Local-only tool; the dashboard binds to 127.0.0.1, same as MCP server; no auth needed | Bind to loopback; document that dashboard should not be exposed on LAN |
| **React/SPA build pipeline in main package** | A bundler (Webpack/Vite) inside the agent-bus repo adds build time and complexity; the dashboard UI can be served as plain HTML + vanilla JS or prebuilt static assets committed to the repo | Bundle the dashboard assets once (or use a CDN link for a tiny JS lib); serve them as static files via Hono |
| **Dynamic plugin hot-reload** | Reloading an ESM module at runtime in Node.js is unreliable and poorly supported; plugins load at daemon start and are immutable for the lifetime of the process | Restart daemon to pick up a changed plugin; this is acceptable for local-first use |
| **Full OpenAPI / AsyncAPI schema specification** | Generating AsyncAPI docs from the schema registry is a nice-to-have but adds tooling complexity for solo developer use | EventCatalog-style discoverability is out of scope; the manifest YAML is the catalog |
| **GUI approval workflow in dashboard** | Approval decisions require understanding context (run state, artifact content); a CLI is more appropriate for safety-critical approval gates | CLI `agent-bus approve` / `agent-bus reject` remains the approval UI; dashboard shows pending approvals as informational read-only |

---

## Feature Details

### 1. SDK / Library Mode

**Current state:** `daemon/index.ts` exports `startDaemon()` and `AgentBusDaemon` interface, but:
- `package.json` has no `exports` field — consumers cannot use clean subpath imports
- TypeScript declaration files are emitted to `dist/` but no `types` field in `package.json`
- `AgentBusDaemon.publish()` signature uses a complex conditional return type that's hard to use from external code
- No documented public surface — internal types leak

**Expected behavior:**
- `package.json` `exports` defines `"."`, `"./adapters"`, `"./config"` subpaths pointing to `dist/` ESM outputs
- `AgentBusDaemon` interface is simplified: `publish()` returns `Promise<{ eventId: string; deliveryIds: string[] }>`
- `startDaemon(options)` is documented as the programmatic entry point
- `AdapterPlugin` interface is exported from `"./adapters"` for plugin authors
- Named re-exports in `src/index.ts` that explicitly list every public type — no accidental leakage of internal store types

**Complexity:** Low–Medium. No new runtime logic. Primary work is surface audit, type simplification, and package.json configuration.

---

### 2. Plugin Adapter System

**Current state:** `adapters/registry.ts` has a closed switch statement over four hardcoded families. Adding a new runtime requires modifying core source.

**Expected behavior:**
- `AgentPlugin` (or `AdapterPlugin`) interface: `{ buildCommand(input: VendorAdapterCommandInput): PreparedAdapterCommand }`
- Agent manifest entry gains an optional `plugin` field: `plugin: "./adapters/my-agent.js"` (path relative to manifest file)
- At daemon start, `loadManifest` (or a new loader step) detects agents with `plugin` field, dynamically imports the module with `await import(resolvedPath)`, validates the default export against the interface
- `buildAdapterCommand` in `registry.ts` checks the plugin map first, then falls back to the built-in switch
- Plugin loading is fail-fast at startup, not lazy — if a plugin cannot be loaded, daemon start rejects with a clear error

**ESM dynamic import note:** Node.js 22+ (`require(esm)` now stable) supports `await import()` of both ESM and CJS. Since agent-bus is already ESM (`"type": "module"` or `.mjs` output), plugins must export as ESM default. This is documented as the plugin contract.

**Key interface (based on existing `VendorAdapterCommandInput` in `claude-code.ts`):**
```typescript
export interface AdapterPlugin {
  buildCommand(input: VendorAdapterCommandInput): PreparedAdapterCommand;
}
```

**Complexity:** Medium. Registry refactor, dynamic import at startup, manifest schema extension, validation.

---

### 3. Event Schema Registry

**Current state:** `event.payload` is `Record<string, unknown>`. No validation occurs at publish time. Agent processes receive unvalidated payloads and must defensively parse.

**Expected behavior:**
- Optional `schemas` section in `agent-bus.yaml` (or a companion `agent-bus.schemas.ts` file):
  ```yaml
  schemas:
    - topic: qa.review.requested
      schema:
        type: object
        properties:
          prNumber: { type: integer }
          diffPath: { type: string }
        required: [prNumber, diffPath]
  ```
- At publish time in `publish-event.ts`, if a schema is registered for the topic, the payload is validated. Validation failure throws a structured error that the caller can handle.
- Schema definition format: JSON Schema (MEDIUM confidence) or inline Zod (HIGH complexity, better DX). Recommended: JSON Schema in manifest (simpler YAML-serializable), converted to Zod schema at daemon start using `z.object(...)` construction.
- Alternative for SDK mode: consumer calls `daemon.registerSchema(topic, zodSchema)` before publishing. This is the "code-first" pattern preferred for TypeScript users.
- Zod v4 `z.registry<{ description: string }>()` can back the in-memory map, providing IDE-visible metadata per topic.
- Schema validation is **optional** — topics without registered schemas continue to work. This preserves backward compatibility.

**Complexity:** Medium. New manifest field, new validator invoked in publish path, Zod integration for schema map.

---

### 4. Web Dashboard

**Current state:** Operator visibility is entirely CLI-based. `daemon/operator-service.ts` exposes `listRunSummaries`, `getRunDetail`, `listFailureDeliveries`, `listPendingApprovalViews`. These are exactly the queries a dashboard needs.

**Expected behavior:**
- A separate `src/dashboard/` package that exports a `startDashboardServer(options)` function
- Backed by Hono + `@hono/node-server` (verified: lightweight, 3.5x faster than Express, serves static files via `serveStatic` middleware, supports SSE via `streamSSE`)
- API endpoints (read-only):
  - `GET /api/runs` → `listRunSummaries()`
  - `GET /api/runs/:runId` → `getRunDetail(runId)`
  - `GET /api/approvals` → `listPendingApprovalViews()`
  - `GET /api/failures` → `listFailureDeliveries()`
  - `GET /api/events` (SSE stream) → pushes delivery lifecycle events from the dispatcher
- Static file serving: `GET /` → serves `dist/dashboard/index.html`
- Dashboard UI: plain HTML + minimal JS (no React build pipeline); uses SSE EventSource to receive live delivery updates
- Lifecycle: started by `startDaemon()` if `dashboard: { port: 8080 }` is in manifest workspace config, or via `--dashboard-port` CLI flag
- Shares daemon's in-memory SQLite connection and dispatcher — no second DB connection

**Dispatcher integration:** The existing `createDispatcher()` in `daemon/dispatcher.ts` already maintains a snapshot of in-flight deliveries. The SSE endpoint subscribes to dispatcher events and pushes state changes to browser clients. This is the lowest-latency update mechanism without polling.

**Key constraint:** Dashboard server and MCP server are separate HTTP servers (different ports). The dashboard serves a human browser UI; the MCP server serves MCP JSON-RPC. They should not share a port.

**Complexity:** High. New HTTP server dependency (Hono), new static asset pipeline (or pre-built assets), SSE event bridge from dispatcher, new manifest config section, new `src/dashboard/` module.

---

### 5. Deprecate `events` Array in Result Envelope

**Current state:** `SuccessfulAdapterResultSchema`, `RetryableAdapterResultSchema`, and `FatalAdapterResultSchema` all include `events: z.array(EmittedEventDraftSchema).default([])`. This was the v1.0 mechanism for agents to emit follow-up events. `MCP-03` shipped in v1.1 as the replacement.

**Expected behavior:**
- `parseAdapterResultEnvelope()` in `contract.ts` emits a structured warning (via pino logger, passed in) when `events.length > 0`
- Warning message: `"result envelope 'events' field is deprecated; use MCP publish_event tool instead"`
- The field continues to work (no breaking change in v1.2)
- Documentation updated to mark `events` as deprecated
- v1.3 target: remove the field and its processing in `adapter-worker.ts`

**Complexity:** Low. Log warning at parse time; no behavior change.

---

## Feature Dependencies

```
SDK packaging (package.json exports, types)
  → Required before any external consumer can use SDK mode
  → Required before plugin interface can be publicly exported

Plugin adapter system
  → Depends on: SDK packaging (AdapterPlugin interface export)
  → Depends on: manifest-schema.ts extension (plugin field on agent)
  → Does NOT depend on: schema registry, dashboard

Event schema registry
  → Depends on: manifest-schema.ts extension (schemas section)
  → Integrates with: publish-event.ts (validation at publish)
  → Does NOT depend on: dashboard or plugin system
  → SDK mode consumers can use registerSchema() API independently

Web dashboard
  → Depends on: existing operator-service.ts (query surface exists)
  → Depends on: existing dispatcher.ts (SSE events)
  → Requires: new npm dependency (Hono + @hono/node-server)
  → Does NOT depend on: plugin system or schema registry
  → Benefits from: schema registry (could display topic schemas in UI — future)

Deprecate events array
  → No dependencies on other v1.2 features
  → Can ship independently in any order
```

---

## MVP Recommendation for v1.2

Build in this order based on complexity and dependency chain:

1. **Deprecate `events` array** — Low complexity, no dependencies, cleans up technical debt. Ship first.
2. **SDK packaging** — Low–Medium complexity, unblocks plugin system and external consumers. Gate on this before publishing SDK docs.
3. **Plugin adapter system** — Medium complexity, depends on SDK packaging for interface export. High value for users with custom agents.
4. **Event schema registry** — Medium complexity, independent. High safety value. Can ship in parallel with plugin system.
5. **Web dashboard** — High complexity, requires Hono dependency, new static asset pipeline, SSE bridge. Ship last; benefits from all other features being stable.

**Defer to v1.3:**
- Dashboard approval actions (approve/reject from browser)
- Schema backward-compatibility checking
- npm publish / release automation
- Dashboard authentication for LAN access

---

## Confidence Assessment

| Feature | Confidence | Source |
|---------|------------|--------|
| SDK mode: startDaemon() shape already correct | HIGH | Direct codebase read — `daemon/index.ts` exports `AgentBusDaemon` |
| SDK mode: package.json exports missing | HIGH | Direct codebase read — no `exports` field present |
| Plugin system: registry.ts is a closed switch | HIGH | Direct codebase read — `buildAdapterCommand` switch in `registry.ts` |
| Plugin system: VendorAdapterCommandInput is right contract | HIGH | Direct codebase read — `adapters/vendors/claude-code.ts` |
| Plugin system: ESM dynamic import in Node 22+ | HIGH | Node.js docs + WebSearch (Node 22 require(ESM) now stable) |
| Schema registry: payload is Record<string,unknown> | HIGH | Direct codebase read — `AdapterEventContextSchema.payload` |
| Schema registry: Zod v4 registry API | HIGH | WebSearch verified vs zod.dev/metadata official docs |
| Schema registry: JSON Schema in manifest (YAML-serializable) | MEDIUM | WebSearch — common pattern in EventBridge, Confluent |
| Web dashboard: Hono for lightweight HTTP + SSE | HIGH | WebSearch verified — Hono supports `streamSSE`, `serveStatic` on Node.js |
| Web dashboard: operator-service.ts query surface sufficient | HIGH | Direct codebase read — `listRunSummaries`, `getRunDetail`, etc. |
| Web dashboard: dispatcher as SSE event source | MEDIUM | Codebase read + pattern inference — dispatcher.snapshot() exists; event hooks not verified |
| Deprecate events array: field exists in contract | HIGH | Direct codebase read — `SuccessfulAdapterResultSchema` |

---

## Sources

- Codebase: `src/daemon/index.ts` (AgentBusDaemon interface, startDaemon)
- Codebase: `src/adapters/registry.ts` (closed switch, buildAdapterCommand)
- Codebase: `src/adapters/vendors/claude-code.ts` (VendorAdapterCommandInput interface)
- Codebase: `src/adapters/contract.ts` (events array, payload schema)
- Codebase: `src/config/manifest-schema.ts` (no schemas or plugin fields)
- Codebase: `src/daemon/mcp-server.ts` (HTTP server pattern on localhost)
- Zod v4 metadata and registries: https://zod.dev/metadata
- Zod v4 release notes: https://zod.dev/v4
- Hono Node.js server: https://github.com/honojs/node-server
- Hono vs Express vs Fastify 2025: https://levelup.gitconnected.com/hono-vs-express-vs-fastify-the-2025-architecture-guide-for-next-js-5a13f6e12766
- Hono SSE streaming: https://hono.dev/docs/helpers/streaming
- Plugin system in Node.js: https://www.n-school.com/plugin-based-architecture-in-node-js/
- TypeScript SDK design: https://azure.github.io/azure-sdk/typescript_design.html
- EventBridge schema registry pattern: https://www.serverless.com/blog/eventbridge-schema-registry
- Node.js ESM dynamic import: https://nodejs.org/api/esm.html
