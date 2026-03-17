<!-- AUTO-GENERATED from .planning/research/ARCHITECTURE.md by scripts/sync-planning-to-gsd.mjs. source-sha256: f35f57a6f54bebb1241091fe14c6097fa8231dbcd65e0f4e2dea90916b819dac. Edit the source file, not this projection. -->

# Architecture Patterns

**Domain:** Local-first event-driven agent orchestration runtime (v1.2 Developer Experience)
**Researched:** 2026-03-17
**Confidence:** HIGH — based on direct codebase analysis of v1.1 baseline

---

## Scope

This document covers only the NEW features being added in v1.2:

- SDK/library mode for programmatic embedding
- Event schema registry with payload validation
- Web dashboard for operator visibility
- Plugin system for runtime adapters
- Deprecation of `events` array in result envelope

The v1.1 architecture (timeouts, structured logging, concurrency, env isolation, MCP server) is documented in the prior version of this file and is treated as baseline stable.

---

## Existing Architecture Baseline (v1.1)

```
CLI entrypoint (src/cli.ts)
  └── startDaemon() [src/daemon/index.ts]  ← composition root
        ├── SQLite stores: EventStore, DeliveryStore, ApprovalStore, RunStore
        ├── Dispatcher (in-memory notification)
        ├── ApprovalService
        ├── DeliveryService
        ├── AdapterWorker
        │     └── process-runner (spawn, SIGTERM/SIGKILL timeout, log pipe)
        ├── ReplayService
        ├── OperatorService
        ├── RecoveryScan (setInterval)
        └── McpServer (HTTP, localhost, random port)

AgentBusDaemon facade (returned by startDaemon)
  — publish, approve, reject, claimDelivery, acknowledgeDelivery,
    failDelivery, replayDelivery, replayEvent, runRecoveryScan,
    listRunSummaries, getRunDetail, listPendingApprovalViews,
    listFailureDeliveries, runWorkerIteration, stop
```

The `AgentBusDaemon` facade is already a clean programmatic interface. v1.2 builds on this foundation without restructuring the core runtime.

---

## v1.2 Component Map: New vs Modified

```
src/
  adapters/
    registry.ts              [MODIFY] — replace static map with pluggable registry
    contract.ts              [MODIFY] — mark events[] as deprecated, add schemaVersion 2
    plugin-adapter.ts        [NEW]    — PluginAdapter interface + loader
  config/
    manifest-schema.ts       [MODIFY] — add schema registry config, plugin adapter refs
  daemon/
    index.ts                 [MODIFY] — wire schema registry + plugin loader into startup
    schema-registry.ts       [NEW]    — per-topic Zod schema map, validate on publish
    publish-event.ts         [MODIFY] — call schema registry validation before persisting
  dashboard/
    server.ts                [NEW]    — HTTP server exposing REST API + static file serving
    api-routes.ts            [NEW]    — REST routes delegating to OperatorService + daemon
    ui/                      [NEW]    — static web assets (HTML/CSS/JS bundle)
  sdk/
    index.ts                 [NEW]    — public SDK surface re-exporting startDaemon + types
    embed.ts                 [NEW]    — AgentBusEmbed: minimal-config embedding helper
```

No new SQLite stores are needed. All four features are additive — they extend existing seams without breaking the delivery state machine or work package contract.

---

## Feature Integration Details

### 1. SDK / Library Mode

**Problem:** Today `startDaemon()` already accepts a `configPath` and returns an `AgentBusDaemon` facade. Programmatic use is technically possible but undocumented and awkward — callers must know internal import paths, and there is no clean entry point or type re-export.

**What is needed:**

- A dedicated `src/sdk/index.ts` that re-exports the stable public surface:
  - `startDaemon` + `StartDaemonOptions` + `AgentBusDaemon`
  - `EventEnvelope` + `ArtifactRef` (the two core domain types)
  - `AdapterWorkPackage` + `AdapterResultEnvelope` (for agent implementations)
  - The Zod schemas that back these types (for validation at call sites)

- An `AgentBusEmbed` convenience wrapper in `src/sdk/embed.ts` for the common case of embedding in another Node.js process without operating a daemon loop:

```typescript
export interface AgentBusEmbedOptions {
  readonly configPath: string;
  readonly repositoryRoot?: string;
  readonly databasePath?: string;
  readonly logger?: DaemonLogger;
}

export interface AgentBusEmbed {
  readonly daemon: AgentBusDaemon;
  publish(envelope: EventEnvelope): PersistedEventRecord;
  subscribe(topic: string, callback: (delivery: DeliveryRecord) => void): () => void;
  stop(): Promise<void>;
}

export function createAgentBusEmbed(options: AgentBusEmbedOptions): Promise<AgentBusEmbed>
```

**Key integration point:** `startDaemon()` already accepts `startRecoveryScan?: boolean` and `registerSignalHandlers?: boolean`. SDK mode callers pass `{ startRecoveryScan: false, registerSignalHandlers: false }` to get a fully embedded instance without background timers or signal hijacking. No change to `startDaemon()` internals needed.

**Modification scope:**
- `src/sdk/index.ts` — NEW (re-exports only, no logic)
- `src/sdk/embed.ts` — NEW (thin wrapper over `startDaemon`)
- `package.json` `exports` field — add `"./sdk"` entry point pointing at `dist/sdk/index.js`

**No changes to existing files required for this feature.**

---

### 2. Event Schema Registry

**Problem:** Event `payload` is currently `z.record(z.string(), z.unknown())` — unvalidated. Subscribers receive whatever the producer sent. Schema mismatches cause silent failures deep in agent execution, far from the publish site.

**Recommended pattern:** Optional per-topic Zod schemas registered at daemon startup. On `publishEvent()`, if a schema is registered for the topic, the payload is validated before the event is persisted.

**New file: `src/daemon/schema-registry.ts`**

```typescript
export interface SchemaRegistryEntry {
  readonly topic: string;
  readonly schema: z.ZodType<unknown>;
  readonly version?: string;
}

export interface SchemaRegistry {
  register(entry: SchemaRegistryEntry): void;
  validate(topic: string, payload: unknown): { valid: true } | { valid: false; errors: string[] };
  has(topic: string): boolean;
}

export function createSchemaRegistry(): SchemaRegistry
```

**Where validation fires:** `publish-event.ts` `publishEvent()` — before the SQLite transaction begins. A validation failure throws a structured error (`SchemaValidationError`) with topic, errors, and the invalid payload shape. The daemon surfaces this to the MCP tool caller as a tool error, and to `daemon.publish()` callers as a thrown exception.

**Manifest integration:** Topics can declare a schema file path in `agent-bus.yaml`:

```yaml
schemas:
  - topic: "build.requested"
    file: ".agent-bus/schemas/build-requested.json"   # JSON Schema
```

The manifest loader reads schema files and registers them at daemon startup. JSON Schema is the portable format (agents of any language can consume it). Internally the daemon converts JSON Schema to a Zod validator using `zod-to-json-schema` in reverse — or more practically, just validates using `ajv` against the raw JSON Schema.

**Alternative (simpler):** Expose `SchemaRegistry` through the SDK. SDK callers register Zod schemas programmatically at startup. Manifest-based registration uses JSON Schema + `ajv` only for the file-based path. This keeps Zod out of the YAML layer (Zod is a TypeScript-only dependency).

**Recommended approach:** Two registration paths:
- Programmatic (SDK callers): `registry.register({ topic, schema: myZodSchema })`
- Manifest-based (YAML config): JSON Schema files, validated with `ajv` (new dependency)

**Modification scope:**
- `src/daemon/schema-registry.ts` — NEW
- `src/daemon/publish-event.ts` — MODIFY (call `registry.validate()` before transaction)
- `src/daemon/index.ts` — MODIFY (instantiate registry, pass to `publishEvent`, expose `registerSchema()` on `AgentBusDaemon` facade)
- `src/config/manifest-schema.ts` — MODIFY (add `schemas[]` array to `AgentBusManifestSchema`)
- `package.json` — ADD `ajv` (for manifest-declared JSON Schema validation)

**Data flow change:**

```
Before: publish(envelope) → validate EventEnvelopeSchema → persist
After:  publish(envelope) → validate EventEnvelopeSchema → validate payload schema (if registered) → persist
```

Validation is synchronous and happens before the SQLite transaction. Failed validation never touches the database.

---

### 3. Web Dashboard

**Problem:** All operator visibility today is CLI-only (`agent-bus runs list`, `agent-bus approvals list`). The `OperatorService` already provides the query methods needed — `listRunSummaries`, `getRunDetail`, `listPendingApprovalViews`, `listFailureDeliveries`. The gap is a browser-accessible UI.

**Architecture decision: Embed dashboard server in the daemon process.**

The dashboard is a lightweight HTTP server on a separate port from the MCP server. It serves:

1. A static SPA (single-page application) bundle at `GET /`
2. A REST API (JSON) at `GET /api/*` delegating to `OperatorService` and the daemon facade

**Why embed in daemon rather than separate process:** All data is in the SQLite database and in-memory dispatcher state. A separate process would need IPC or direct SQLite access (read-only connection). Embedding is simpler — the dashboard server gets direct synchronous access to the same stores.

**New files:**

`src/dashboard/server.ts` — HTTP server lifecycle:

```typescript
export interface DashboardServerOptions {
  readonly operatorService: ReturnType<typeof createOperatorService>;
  readonly approvalService: ReturnType<typeof createApprovalService>;
  readonly port?: number;   // 0 = OS-assigned
  readonly logger?: DaemonLogger;
}

export interface DashboardServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

export async function startDashboardServer(
  options: DashboardServerOptions
): Promise<DashboardServerHandle>
```

`src/dashboard/api-routes.ts` — route handlers:

| Route | Method | Data Source | Purpose |
|-------|--------|-------------|---------|
| `/api/runs` | GET | `operatorService.listRunSummaries()` | Run list |
| `/api/runs/:runId` | GET | `operatorService.getRunDetail()` | Run detail |
| `/api/approvals` | GET | `operatorService.listPendingApprovalViews()` | Pending approvals |
| `/api/approvals/:id/approve` | POST | `approvalService.approve()` | Approve gate |
| `/api/approvals/:id/reject` | POST | `approvalService.reject()` | Reject gate |
| `/api/failures` | GET | `operatorService.listFailureDeliveries()` | Dead-letter view |
| `/api/manifest` | GET | `daemon.manifest` | Manifest inspection |

`src/dashboard/ui/` — static assets. Options:

- **Minimal option:** Single `index.html` with vanilla JS fetching the REST API. No build toolchain. Ships inside the npm package as plain files. Deployed into `dist/dashboard/ui/`.
- **Full option:** Vite + React SPA, bundled at build time. More work but richer UX.

**Recommendation: Minimal option for v1.2.** A single-file HTML + JS dashboard satisfies "operator visibility" without adding a frontend build pipeline to a TypeScript daemon project. The API contract can support a richer SPA later without changes.

**Startup integration:** `startDaemon()` gains an optional `dashboard?: { enabled: boolean; port?: number }` option. When enabled, `startDashboardServer()` is called alongside `createMcpServer()` during daemon startup. The dashboard URL is logged at startup.

**Modification scope:**
- `src/dashboard/server.ts` — NEW
- `src/dashboard/api-routes.ts` — NEW
- `src/dashboard/ui/index.html` — NEW (static asset)
- `src/daemon/index.ts` — MODIFY (optionally start dashboard server, expose `dashboardUrl` on facade)
- `StartDaemonOptions` — MODIFY (add `dashboard?` field)
- `AgentBusDaemon` interface — MODIFY (add `dashboardUrl?: string`)

**No new npm dependencies required** if using vanilla JS for the UI and Node.js built-in `node:http` for the server (same pattern as MCP server).

---

### 4. Plugin System for Runtime Adapters

**Problem:** Today `registry.ts` contains a static map of four runtime families (`codex`, `open-code`, `gemini`, `claude-code`). Adding a new adapter requires editing a built-in source file and cutting a new release. There is no way for users to provide their own adapter without forking.

**Current adapter contract:**

```typescript
// What an adapter must produce:
interface PreparedAdapterCommand {
  command: string;
  args: string[];
  workingDirectory: string;
  environment: Record<string, string>;
}

// Current builder function signature (per-vendor):
function buildXxxCommand(input: VendorBuildInput): PreparedAdapterCommand
```

**Recommended plugin interface:**

```typescript
// src/adapters/plugin-adapter.ts
export interface PluginAdapterDefinition {
  readonly family: string;                  // Unique identifier (e.g. "my-custom-agent")
  readonly displayName: string;
  readonly executableCandidates: readonly string[];
  readonly executionMode: "non_interactive_cli" | "editor_cli";
  buildCommand(input: BuildAdapterCommandInput): PreparedAdapterCommand;
}

export interface PluginAdapterLoader {
  load(specifier: string): Promise<PluginAdapterDefinition>;
}
```

**Plugin loading mechanism:** Manifest declares plugin adapters by module specifier:

```yaml
adapters:
  plugins:
    - family: "my-custom-agent"
      module: "./adapters/my-agent-adapter.js"   # relative to repositoryRoot
```

At daemon startup, `loadManifest()` returns the plugin specifiers. `startDaemon()` dynamically imports each module (`import(absolutePath)`), calls a `createAdapter()` default export, and registers the returned `PluginAdapterDefinition` alongside the built-in adapters.

**Modified registry pattern:**

```typescript
// Existing static map becomes the "built-in registry"
// Registry gains a runtime registration method:
export function registerPluginAdapter(definition: PluginAdapterDefinition): void
export function buildAdapterCommand(input: BuildAdapterCommandInput): PreparedAdapterCommand
// buildAdapterCommand checks plugin registry before falling back to generic manifest command
```

**Plugin resolution in `buildAdapterCommand`:**

```
input.agent.runtime matches built-in family? → use built-in vendor builder
input.agent.runtime matches registered plugin family? → use plugin.buildCommand()
neither → use generic manifest command (current fallback, unchanged)
```

**Modification scope:**
- `src/adapters/plugin-adapter.ts` — NEW (PluginAdapterDefinition interface + loader)
- `src/adapters/registry.ts` — MODIFY (add `registerPluginAdapter()`, check plugin registry in `buildAdapterCommand()`)
- `src/config/manifest-schema.ts` — MODIFY (add `adapters.plugins[]` array)
- `src/daemon/index.ts` — MODIFY (load plugins at startup, register before adapter worker starts)

**Security note:** Dynamic `import()` of user-supplied module paths runs arbitrary code. Document clearly: plugins execute in the daemon process with full trust. No sandbox. This is consistent with the existing trust model (agents already run arbitrary commands on the local machine).

---

### 5. Deprecate `events` Array in Result Envelope

**Problem:** `SuccessfulAdapterResultSchema.events` (and its counterparts in `RetryableAdapterResultSchema`, `FatalAdapterResultSchema`) was the original mechanism for agents to emit follow-up events. MCP `publish_event` superseded it in v1.1. The array creates confusion: should agents use MCP, the result envelope, or both?

**Deprecation approach:**

- Keep `events` in the schema at `schemaVersion: 1` — no breaking change
- Add `schemaVersion: 2` result envelope schemas that omit the `events` field entirely
- Adapter worker: process `events` from schemaVersion 1 results as before; emit a deprecation warning in the structured log when it is used (non-empty `events` array)
- Documentation: mark `events` as deprecated, MCP as the preferred path
- Remove in v1.3 (after one milestone of deprecation warnings)

**Modification scope:**
- `src/adapters/contract.ts` — MODIFY (add `schemaVersion: 2` variants without `events`, update `AdapterResultEnvelopeSchema` to accept both)
- `src/daemon/adapter-worker.ts` — MODIFY (emit deprecation log when `events.length > 0` from a v1 result)

---

## Data Flow Changes (v1.1 → v1.2)

### Publish flow with schema registry

```
daemon.publish(envelope)
  → EventEnvelopeSchema.parse(envelope)          [existing]
  → schemaRegistry.validate(topic, payload)      [NEW — if schema registered]
  → throw SchemaValidationError if invalid       [NEW]
  → persistPublishedEvent()                      [existing]
  → dispatchPublishedEvent()                     [existing]
```

### Adapter selection with plugin registry

```
claimDelivery → buildAdapterCommand(input)
  → getRuntimeDefinition(runtime)               [existing — built-in lookup]
  → getPluginDefinition(runtime)                [NEW — plugin fallback]
  → fallback to generic manifest command        [existing]
```

### Dashboard request flow

```
Browser → GET /api/runs
  → dashboard HTTP server (node:http)
  → api-routes handler
  → operatorService.listRunSummaries()          [existing — same method CLI uses]
  → JSON response
```

### SDK embedding flow

```
import { createAgentBusEmbed } from 'agent-bus/sdk'
  → calls startDaemon({ startRecoveryScan: false, registerSignalHandlers: false, ... })
  → returns AgentBusEmbed wrapping AgentBusDaemon
  → embed.publish(envelope) → daemon.publish(envelope)
  → embed.subscribe(topic, cb) → polling wrapper over dispatcher snapshot
```

---

## Component Boundaries After v1.2

| Component | Responsibility | Communicates With | New/Modified |
|-----------|---------------|-------------------|--------------|
| `sdk/index.ts` | Public API surface re-export | (re-exports only) | NEW |
| `sdk/embed.ts` | Embedding helper, no daemon loop | `daemon/index.ts` | NEW |
| `daemon/schema-registry.ts` | Per-topic payload validation | Called from `publish-event.ts` | NEW |
| `dashboard/server.ts` | HTTP server for browser UI | `operator-service.ts`, `approval-service.ts` | NEW |
| `dashboard/api-routes.ts` | REST route handlers (JSON) | `operator-service.ts`, `approval-service.ts` | NEW |
| `dashboard/ui/index.html` | Static SPA | Browser fetches `/api/*` | NEW |
| `adapters/plugin-adapter.ts` | PluginAdapterDefinition interface | Loaded by `registry.ts` | NEW |
| `adapters/registry.ts` | Built-in + plugin adapter dispatch | `plugin-adapter.ts`, vendor builders | MODIFY |
| `adapters/contract.ts` | Work package + result envelope schemas | v1 + v2 result envelope variants | MODIFY |
| `config/manifest-schema.ts` | YAML schema | Add schemas[], adapters.plugins[] | MODIFY |
| `daemon/index.ts` | Composition root | Start dashboard, load plugins, wire schema registry | MODIFY |
| `daemon/publish-event.ts` | Event persistence + fan-out | Call schema registry before transaction | MODIFY |
| `daemon/adapter-worker.ts` | Delivery execution | Log deprecation on events[] usage | MODIFY |

All other components (DeliveryService, RecoveryScan, ReplayService, McpServer, ApprovalService) are **unchanged** in v1.2.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mandatory Schema Validation

**What:** Require a registered schema for every topic; reject events with unregistered topics.
**Why bad:** This would break existing manifests that do not declare schemas. Schema registration must be opt-in — validation fires only when a schema is registered.
**Instead:** Registry returns `{ valid: true }` for any topic without a registered schema. Validation is purely additive.

### Anti-Pattern 2: Separate Dashboard Process

**What:** Run the dashboard as a standalone `agent-bus dashboard` process that opens its own SQLite connection.
**Why bad:** `node:sqlite` supports WAL mode with concurrent reads, but running a second writer (if dashboard ever needs writes — e.g., approve/reject) risks lock contention. The embedded pattern with a single connection is the established pattern in this codebase.
**Instead:** Dashboard runs in the daemon process. API routes delegate to OperatorService and ApprovalService that already hold the single database connection.

### Anti-Pattern 3: Plugin Adapters as npm Packages Only

**What:** Require plugins to be published npm packages that are npm-installed.
**Why bad:** Forces users through a publish-install cycle for local custom adapters. Breaks the "single repository, no external infra" value proposition.
**Instead:** Module specifier in manifest is a relative path (`./adapters/my-agent.js`) resolved against `repositoryRoot`. Standard npm packages also work (bare specifiers resolved by Node.js). Both are handled by `import(specifier)`.

### Anti-Pattern 4: SDK as a Separate Package

**What:** Publish `@agent-bus/sdk` as a separate npm package.
**Why bad:** Introduces a versioning split — the SDK and daemon can drift out of sync. Users must manage two package versions.
**Instead:** SDK is a sub-path export of the existing `agent-bus` package: `import { createAgentBusEmbed } from 'agent-bus/sdk'`. This is the standard Node.js `exports` map pattern — no new package needed.

### Anti-Pattern 5: React/Vite Build Pipeline for Dashboard UI

**What:** Build the dashboard SPA with a full frontend toolchain (Vite, React, esbuild).
**Why bad:** Adds a separate build step, frontend devDependencies, and bundle artifacts to a TypeScript daemon project. Increases contributor friction significantly.
**Instead:** Vanilla HTML + inline JavaScript for v1.2. The REST API is the stable contract — a richer SPA can be added later without changing any server-side code.

---

## Build Order (Dependency-Ordered)

```
1. manifest-schema.ts changes (schemas[], adapters.plugins[])
   └── All new features that touch the manifest schema must read from here

2. src/adapters/plugin-adapter.ts (new interface, no dependencies on other new files)
   └── Defines the contract that manifest loading and registry consume

3. Plugin registry modification in adapters/registry.ts
   └── depends on: plugin-adapter.ts interface

4. src/daemon/schema-registry.ts (new, standalone)
   └── no dependencies on other new v1.2 files

5. publish-event.ts schema validation wiring
   └── depends on: schema-registry.ts

6. daemon/index.ts: load plugins + wire schema registry
   └── depends on: plugin-adapter.ts, registry.ts changes, schema-registry.ts

7. src/sdk/index.ts + sdk/embed.ts
   └── depends on: daemon/index.ts being stable (startDaemon stable interface)
   └── additive only, no existing file changes

8. src/dashboard/server.ts + api-routes.ts + ui/
   └── depends on: OperatorService and ApprovalService interfaces (already stable)
   └── daemon/index.ts integration: add dashboard startup option
   └── highest integration surface but most self-contained new code

9. contract.ts schemaVersion 2 + adapter-worker.ts deprecation logging
   └── final, least risky — purely additive schema variant + one log line
```

**Recommended phase order:**

| Phase | Features | Rationale |
|-------|----------|-----------|
| Phase 1 | Plugin adapter system | Lowest risk. New interface + registry modification. No behavior change for existing adapters. Tests can verify built-in adapters still work. |
| Phase 2 | Event schema registry | Isolated new component. Validates at publish boundary only. Fully opt-in — existing manifests unchanged. |
| Phase 3 | SDK / library mode | Re-exports + thin wrapper. Zero behavior change. Validates the `startDaemon` API is clean before users call it. |
| Phase 4 | Web dashboard | Largest new code surface (HTTP server + UI). Builds on stable OperatorService. Deploy last to ensure the data layer it reads from is validated. |
| Phase 5 | Deprecate events[] | Final cleanup. After dashboard and SDK are validated. Low risk — one log line + schema variant addition. |

---

## Scalability Considerations

| Concern | v1.2 (local, single user) | Future |
|---------|--------------------------|--------|
| Dashboard concurrent viewers | Single user, localhost only — Node.js built-in HTTP is sufficient | Add SSE or WebSocket for live refresh in v1.3+ |
| Schema registry size | Small (10-50 topics max in local repos) — in-memory Map | No concern at this scale |
| Plugin load time | Startup-time dynamic import — negligible for 1-5 plugins | Plugin caching already handled by Node.js module cache |
| Dashboard data volume | listRunSummaries() defaults to limit 20 — already paginated | Add cursor-based pagination to API if run counts grow |

---

## Open Questions

1. **Schema registry: JSON Schema vs Zod for manifest-declared schemas.** If manifest-declared schemas use JSON Schema (portable, file-based), the daemon needs `ajv`. If they use TypeScript/Zod files, the daemon needs to `import()` them (same dynamic import mechanism as plugins). JSON Schema is safer (no code execution on load) but less ergonomic for TypeScript users. Recommendation: JSON Schema + ajv for v1.2, Zod registration via SDK for programmatic users. Confirm before implementation.

2. **Dashboard authentication.** The dashboard exposes approve/reject actions over HTTP. Even on localhost, a CSRF vector exists if the user has malicious browser extensions or open ports. A simple CSRF token (random secret generated at startup, required as a request header) would close this without requiring login UX. Decide before implementing the approve/reject API routes.

3. **Plugin hot-reload.** Should plugins be re-loaded when the manifest changes (if manifest watching is added in a future version)? For v1.2, plugins are loaded once at daemon startup. Document this constraint explicitly.

4. **`events[]` deprecation timeline.** PROJECT.md marks `events` deprecation as an Active v1.2 requirement. The question is whether to remove the field in v1.2 (breaking for existing agents still writing result envelopes with events) or merely log a warning. Given the backward-compatibility constraint in CLAUDE.md, a warning-only approach is correct for v1.2 with removal in v1.3.

5. **Dashboard URL exposure.** Should the dashboard URL be injected into work packages (like `AGENT_BUS_MCP_URL`)? Agents could then generate dashboard deep links in summaries. Likely out of scope for v1.2 — the dashboard is an operator tool, not an agent-facing tool.

---

## Sources

- Direct codebase analysis: `src/adapters/registry.ts`, `src/adapters/contract.ts`, `src/daemon/index.ts`, `src/daemon/publish-event.ts`, `src/daemon/operator-service.ts`, `src/config/manifest-schema.ts` — HIGH confidence
- `.gsd/SPEC.md` v1.2 requirements — HIGH confidence
- Prior v1.1 architecture research in this file — HIGH confidence
- Node.js `exports` map pattern for sub-path SDK entry point — HIGH confidence (stable Node.js 12+ feature)
- `ajv` for JSON Schema validation — MEDIUM confidence (de-facto standard, verify version compatibility with ESM before adding)
