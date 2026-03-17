# Project Research Summary

**Project:** Agent Bus v1.2 — Developer Experience
**Domain:** Local-first event-driven agent orchestration runtime — SDK packaging, schema validation, operator visibility, extensibility
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

Agent Bus v1.2 is a developer experience milestone for an already-functioning orchestration runtime. The v1.1 foundation is solid: SQLite with WAL, a durable delivery state machine, pino structured logging, MCP server, and four built-in agent adapters. The v1.2 scope is additive rather than architectural — the research found that three of four new features (SDK mode, event schema registry, plugin adapter system) require zero new npm dependencies and build directly on existing seams in the codebase. Only the web dashboard requires new production dependencies (`hono` + `@hono/node-server`), and these are lightweight, ESM-native, and well-suited to the project's minimal-dependency philosophy.

The recommended implementation approach is phased in dependency order: stabilize the adapter registry first (plugin system), then add optional payload validation at the publish boundary (schema registry), then surface the programmatic API cleanly (SDK packaging), and finally layer the dashboard on top of the already-queryable `OperatorService`. This order avoids premature API exposure, keeps each phase testable in isolation, and defers the highest-complexity feature — the dashboard with HTTP server lifecycle, SSE, and static assets — until the data layer it reads from is validated. The `events[]` deprecation is a low-risk cleanup that can ship at any point.

The primary risk is the SDK mode transition: `startDaemon()` was designed as a CLI entry point, and exposing it as a library surface requires deliberate decisions about signal handler ownership, in-flight worker drain on `stop()`, and stable public types that do not leak internal storage layer shapes. These are not hard problems, but they must be addressed before the SDK is promoted as a public API. Secondary risk is schema validation enforcement mode — strict validation on an existing unvalidated pipeline will break every existing agent on first rollout unless a warn-first strategy is adopted.

## Key Findings

### Recommended Stack

Three of four v1.2 features are built from existing dependencies: Zod v4's `z.registry()` and `z.toJSONSchema()` cover the schema registry, the `package.json` `"exports"` field covers SDK packaging, and ESM dynamic `import()` covers plugin loading. Only the web dashboard adds new production dependencies. `hono` (^4.12.8) and `@hono/node-server` (^1.19.11) are the right choice — ultralight (7.6 kB gzipped, zero transitive dependencies), Web Standards-first, ESM-native, and 3.5x faster than Express. No frontend build step is needed; a single-file vanilla HTML dashboard is sufficient for v1.2 operator visibility. One open question: manifest-declared JSON Schema validation may require `ajv` as an additional dependency, but this can be deferred by scoping the schema registry to SDK-mode programmatic registration (Zod only) for v1.2.

**Core technologies:**
- `zod` (^4.3.6, already present): `z.registry()` + `z.toJSONSchema()` for event schema registry — Zod v4 built-ins replace any need for external schema tools
- `hono` (^4.12.8, NEW): HTTP framework for web dashboard — minimal, ESM-native, no build pipeline required
- `@hono/node-server` (^1.19.11, NEW): Node.js adapter for Hono — required companion for Node.js 22+
- `package.json "exports"` (Node.js built-in): SDK sub-path entry points — standard, no library
- ESM `import()` (Node.js 22+ built-in): Plugin adapter loading at daemon startup — no loader library needed

### Expected Features

**Must have (table stakes):**
- **SDK/library mode (`startDaemon()` as public API)** — any embeddable tool needs a stable programmatic entry point; `daemon/index.ts` is mostly the right shape; gap is `package.json exports`, TypeScript declarations, stable public types, and surface audit
- **Plugin adapter system (external runtimes loaded by manifest)** — the closed `switch` in `registry.ts` forces a core fork to add any fifth adapter; plugin loading via ESM `import()` with an open `Map`-based registry is the correct fix
- **Event schema registry (per-topic payload validation)** — payloads are currently `Record<string, unknown>` with no validation; mismatches fail silently deep in agent execution far from the publish site
- **Deprecate `events[]` in result envelope** — MCP `publish_event` replaced this in v1.1; two competing patterns create confusion; warn-only in v1.2, remove in v1.3

**Should have (differentiators):**
- **Web dashboard (local HTTP + static UI)** — turns a CLI-only black box into something observable in real time; `OperatorService` already exposes the full query surface; Hono + vanilla HTML avoids a frontend build pipeline
- **SDK: programmatic publish + subscribe for test harnesses** — integration tests currently must spawn a real daemon process; an importable `startDaemon` with `registerSignalHandlers: false` enables in-process workflow testing

**Defer to v1.3+:**
- Dashboard approval actions (approve/reject from browser) — CLI remains the approval UI; safety-critical decisions belong in CLI, not a browser tab
- Schema backward-compatibility checking (Confluent-style) — Kafka-grade complexity for a single-repo local tool
- npm publish / release automation — out of scope for local-first solo developer tooling
- Dashboard authentication for LAN access — localhost binding is sufficient for v1.2
- Plugin hot-reload — ESM module cache is permanent per process; restart is the correct model

### Architecture Approach

All four v1.2 features are additive to the existing composition root in `daemon/index.ts`. No new SQLite stores are needed. Five files are new (`plugin-adapter.ts`, `schema-registry.ts`, `sdk/index.ts`, `sdk/embed.ts`, `dashboard/server.ts` + supporting files) and five existing files require targeted modifications (`registry.ts`, `manifest-schema.ts`, `daemon/index.ts`, `publish-event.ts`, `contract.ts`). The dashboard embeds in the daemon process to share the single SQLite connection and avoid WAL lock contention from a second writer; the dashboard's read queries use a separate read-only connection with `PRAGMA query_only = ON`.

**Major components:**
1. `src/adapters/plugin-adapter.ts` (NEW) — `PluginAdapterDefinition` interface; open `Map`-based registry replaces the closed `SupportedRuntimeFamilySchema` enum in `registry.ts`
2. `src/daemon/schema-registry.ts` (NEW) — per-topic Zod schema map with warn/reject enforcement modes; validation fires before the SQLite transaction in `publish-event.ts`
3. `src/sdk/index.ts` + `src/sdk/embed.ts` (NEW) — re-exports of stable public types + thin `createAgentBusEmbed` wrapper; zero new daemon logic
4. `src/dashboard/server.ts` + `src/dashboard/api-routes.ts` + `src/dashboard/ui/` (NEW) — Hono HTTP server delegating to existing `OperatorService` and `ApprovalService`; vanilla HTML single-file UI
5. `src/config/manifest-schema.ts` (MODIFY) — add `schemas[]` and `adapters.plugins[]` sections; this is the shared seam all features read from

### Critical Pitfalls

1. **Signal handler registration in SDK/embedded mode** — `startDaemon()` registers `process.once("SIGINT/SIGTERM")` by default; in Jest/Vitest test harnesses this fires during teardown and kills the runner mid-suite. Prevention: default `registerSignalHandlers: false` in SDK mode; add a `createDaemonForProcess()` factory for CLI use that explicitly opts into signal handlers.

2. **Internal storage types leaked as the public SDK API** — `AgentBusDaemon` was designed for internal composition; `ReturnType<...>` chains over store primitives become breaking changes on any field rename once external. Prevention: define `src/sdk/types.ts` with stable public shapes (`DeliveryRecord`, `RunSummary`) and map internal types at the `startDaemon` boundary; never export `PersistedDeliveryRecord` or storage-derived types.

3. **Schema validation rejects existing agents on rollout** — strict Zod/Ajv validation on an unvalidated pipeline dead-letters every existing agent on first publish after the registry is enabled. Prevention: warn mode first (`schemaEnforcement: "warn" | "reject"` per topic in manifest); `.passthrough()` default on all registry schemas; strict enforcement is opt-in per topic.

4. **Closed `SupportedRuntimeFamilySchema` enum silently bypasses plugin `buildCommand()`** — user-defined runtime families fall through to `buildGenericManifestCommand()` without calling the plugin's custom builder; no error, just wrong behavior. Prevention: replace the closed enum with an open `Map<string, PluginAdapterDefinition>`; add startup validation that every manifest `runtime` has a registered adapter.

5. **SSE connections prevent `daemon.stop()` from resolving** — `http.Server.close()` does not terminate existing keep-alive or SSE connections; test teardown hangs indefinitely if a browser tab holds the dashboard open. Prevention: call `server.closeAllConnections()` (Node.js 18.2+) before `server.close()` during shutdown; add a 3-second fallback timeout.

## Implications for Roadmap

Based on combined research across all four files, the dependency graph is clear and the phase structure follows naturally.

### Phase 1: Plugin Adapter System

**Rationale:** Lowest implementation risk. Pure interface addition plus registry refactor — no behavior change for existing built-in adapters. Unblocks all subsequent work that depends on the manifest schema extension (`adapters.plugins[]`). Also has the most "silent wrong behavior" failure mode (Pitfall 11) that must be fixed before the registry pattern is relied on by other phases.
**Delivers:** Open `Map`-based adapter registry; `PluginAdapterDefinition` interface exported from `src/adapters/plugin-adapter.ts`; manifest `adapters.plugins[]` support; ESM `import()` plugin loading at daemon startup; startup validation that every manifest `runtime` has a registered adapter.
**Addresses:** Plugin adapter system (table stakes), removes need to fork core for custom runtimes.
**Avoids:** Pitfall 4 (ESM cache — document constraint before implementation), Pitfall 9 (plugin contract prohibiting `process.exit()`), Pitfall 11 (closed enum silent bypass — this phase fixes it), Pitfall 15 (unregistered runtime silent fallback — startup validation).

### Phase 2: Event Schema Registry

**Rationale:** Isolated new component with a single well-defined integration point. Fully opt-in — existing manifests without `schemas[]` are unaffected. Delivers immediate safety value by catching payload mismatches at publish time. Can be developed in parallel with Phase 3 but benefits from Phase 1's manifest schema extension being committed.
**Delivers:** `SchemaRegistry` interface in `src/daemon/schema-registry.ts`; per-topic Zod schema map; `warn`/`reject` enforcement modes per topic; manifest `schemas[]` section; `daemon.registerSchema()` on the `AgentBusDaemon` facade for SDK callers; validation fires pre-transaction in `publish-event.ts`.
**Uses:** Zod v4 `z.registry()` and `z.toJSONSchema()` — already in dependencies, no new packages (unless JSON Schema + `ajv` path is in scope).
**Avoids:** Pitfall 3 (strict validation rollout — warn mode first; `.passthrough()` default), Pitfall 8 (JSON Schema vs Zod — use Zod for programmatic; defer `ajv` decision), Pitfall 12 (validation inside transaction — validate before `BEGIN`; compile validators once at startup).

### Phase 3: SDK / Library Mode

**Rationale:** Re-exports and thin wrapper, zero new daemon logic. Ships after the plugin system and schema registry are validated so the public API surface reflects a complete and stable `startDaemon` interface. This phase also implements the `stop()` drain fix which is a pre-condition for Phase 4 (dashboard shutdown tests are meaningless without a draining `stop()`).
**Delivers:** `package.json "exports"` map with `"."` and `"./sdk"` subpaths; `src/sdk/index.ts` re-exports; `src/sdk/embed.ts` `createAgentBusEmbed` wrapper; `src/sdk/types.ts` stable public shapes decoupled from storage internals; `registerSignalHandlers: false` as SDK default; `stop()` drain via `Promise.allSettled(activeWorkers)` before `database.close()`; documented public surface.
**Avoids:** Pitfall 1 (signal handlers — default false; `createDaemonForProcess` factory for CLI), Pitfall 2 (internal types leaked — `src/sdk/types.ts` stable boundary), Pitfall 7 (`stop()` drain — this phase fixes it), Pitfall 13 (dual-instance — ESM-only, no CJS entry point).

### Phase 4: Web Dashboard

**Rationale:** Highest new code surface area. Deferred until `stop()` drain is in place (Phase 3) so that dashboard SSE shutdown tests are meaningful. The data layer (`OperatorService`, `ApprovalService`) has been exercised by Phase 1-3 testing, providing confidence before the dashboard reads from it.
**Delivers:** `src/dashboard/server.ts` Hono HTTP server on a separate port; `src/dashboard/api-routes.ts` REST routes (`GET /api/runs`, `/api/runs/:id`, `/api/approvals`, `/api/failures`); `src/dashboard/ui/index.html` vanilla JS single-file UI; optional SSE event stream from dispatcher; manifest `dashboard: { enabled, port }` config; `dashboardUrl` on `AgentBusDaemon` facade; separate read-only SQLite connection with `PRAGMA query_only = ON`.
**Uses:** `hono` ^4.12.8 + `@hono/node-server` ^1.19.11 — the only new production dependencies in the entire v1.2 scope.
**Avoids:** Pitfall 5 (port conflict — `Promise.all` startup; fail fast if dashboard port == MCP port; cleanup both on failure), Pitfall 6 (shared write connection — dedicated read-only connection), Pitfall 10 (SSE prevents stop — `server.closeAllConnections()` before `server.close()`), Pitfall 14 (stale reads — document WAL snapshot isolation; add "last updated" timestamp to responses).

### Phase 5: Deprecate `events[]` in Result Envelope

**Rationale:** Lowest risk change in the entire v1.2 scope — one structured log line plus a schema variant addition in `contract.ts`. Placed last because it is fully independent of all other phases and benefits from Phase 3's SDK types work (the result envelope schema is part of the public surface). Clean up last, after everything else is validated.
**Delivers:** Structured deprecation warning in `adapter-worker.ts` when `events.length > 0`; `schemaVersion: 2` result envelope variants in `contract.ts` without the `events` field; documentation marking `events` as deprecated with v1.3 removal target.
**Addresses:** Legacy cleanup of the `events[]` pattern superseded by MCP `publish_event` in v1.1.

### Phase Ordering Rationale

- **Manifest schema first (within Phase 1):** `manifest-schema.ts` is the shared seam for all four feature areas; its changes must be backward-compatible and land before downstream phases read from them.
- **Interface definitions before wiring:** `PluginAdapterDefinition` and `SchemaRegistry` interfaces are defined and independently testable before `daemon/index.ts` is modified to wire them.
- **SDK before dashboard:** `stop()` drain must be fixed in Phase 3 before Phase 4 SSE shutdown tests are meaningful. Dashboard also benefits from stable public types defined in Phase 3.
- **Dashboard last:** Largest new code surface; depends on all other phases being stable; no features depend on the dashboard.
- **Deprecation any time:** `events[]` deprecation is fully independent; Phase 5 placement is preference, not a dependency constraint.
- This order is consistent across all three research files — FEATURES.md, ARCHITECTURE.md, and PITFALLS.md independently converge on the same sequence.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Web Dashboard):** SSE dispatcher integration needs verification — `createDispatcher()` has a `snapshot()` method but delivery state change event hooks are not confirmed in the source. Verify `src/daemon/dispatcher.ts` before designing the SSE endpoint; if no event hooks exist, add a lightweight emitter to the dispatcher. Also confirm `server.closeAllConnections()` behavior within the `@hono/node-server` adapter (may require manual connection tracking).
- **Phase 2 (Schema Registry) — JSON Schema path:** If manifest-declared JSON Schema validation is in scope for v1.2 (vs SDK-only Zod registration), verify `ajv` v8+ ESM compatibility with `"type": "module"` on Node.js 22.12+ before adding the dependency.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Plugin Adapter System):** ESM `import()` and `Map`-based registry are well-documented Node.js 22+ patterns. Direct codebase read confirms the exact seam to modify.
- **Phase 3 (SDK Mode):** `package.json "exports"` and TypeScript `declaration: true` are established standards. The `startDaemon` interface is already correct — work is surfacing and documenting, not inventing.
- **Phase 5 (Deprecation):** One log line and a schema variant. No research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All key decisions verified against live npm registry and official docs (Zod v4, Hono). Two new dependencies confirmed at specific versions via npm registry. Zero-dependency decisions verified by direct codebase read. |
| Features | HIGH | All features verified against direct codebase read. Gap between what exists and what is needed is precisely characterized for each feature. One MEDIUM item: JSON Schema vs Zod for manifest-declared schemas — decision deferred. |
| Architecture | HIGH | Component map derived from direct analysis of all relevant source files. Build order validated by cross-referencing FEATURES.md, ARCHITECTURE.md, and PITFALLS.md — all three independently agree on the same sequence. One MEDIUM item: dispatcher SSE event hooks not fully verified. |
| Pitfalls | HIGH (critical), MEDIUM (schema enforcement) | Signal handler, closed enum, SSE shutdown, and internal type leakage pitfalls are platform-level facts with documented behavior. Schema enforcement mode patterns are derived from Confluent/Solace distributed systems docs applied to a local use case. |

**Overall confidence:** HIGH

### Gaps to Address

- **Dispatcher SSE event emission:** ARCHITECTURE.md notes `createDispatcher()` has `snapshot()` but delivery state change emission hooks are not confirmed. Verify in `src/daemon/dispatcher.ts` before designing the Phase 4 SSE endpoint. If no hooks exist, add a lightweight EventEmitter to the dispatcher as part of Phase 4 scope.
- **`ajv` ESM compatibility decision:** If JSON Schema validation in manifest-declared schemas is in scope for v1.2 (vs SDK-only Zod registration), verify `ajv` v8+ ESM compatibility with Node.js 22.12+ `"type": "module"` before adding the dependency. Recommended: scope the schema registry to Zod-only (programmatic) for v1.2 and defer `ajv` + JSON Schema file path to v1.3.
- **CSRF protection for dashboard approve/reject routes:** ARCHITECTURE.md raises a CSRF risk for approve/reject API actions even on localhost. A startup-generated random secret token required as a request header would close this. However, FEATURES.md recommends deferring dashboard approval actions to v1.3 entirely — if that deferral holds, this gap disappears for v1.2.
- **`stop()` drain scope:** Phase 3 adds `Promise.allSettled(activeWorkers)` drain to `stop()`. This is also a latent correctness issue for the CLI daemon (not just SDK mode). Confirm whether fixing drain for the CLI daemon is acceptable as part of Phase 3, or whether it should be scoped strictly to SDK mode.

## Sources

### Primary (HIGH confidence)
- `src/daemon/index.ts` — `startDaemon`, `AgentBusDaemon` interface, signal handler registration
- `src/adapters/registry.ts` — closed `SupportedRuntimeFamilySchema` enum, `buildAdapterCommand` switch
- `src/adapters/vendors/claude-code.ts` — `VendorAdapterCommandInput` contract shape
- `src/adapters/contract.ts` — `events[]` field, result envelope schemas
- `src/daemon/publish-event.ts` — event publish pipeline, transaction boundary
- `src/daemon/operator-service.ts` — `listRunSummaries`, `getRunDetail`, `listPendingApprovalViews`, `listFailureDeliveries`
- `src/config/manifest-schema.ts` — current manifest shape, confirmed absence of `schemas[]` and `plugins[]`
- https://zod.dev/v4 — Zod v4 release notes; `z.toJSONSchema()` and `z.registry()` confirmed
- https://zod.dev/metadata — Zod metadata/registry API confirmed
- https://www.npmjs.com/package/hono — version 4.12.8 confirmed
- https://www.npmjs.com/package/@hono/node-server — version 1.19.11 confirmed
- https://hono.dev/docs/getting-started/nodejs — Hono Node.js integration confirmed

### Secondary (MEDIUM confidence)
- https://docs.confluent.io/platform/current/schema-registry/ — schema enforcement mode patterns (warn vs reject)
- https://docs.solace.com/Schema-Registry/schema-registry-best-practices.htm — schema registry best practices
- https://theburningmonk.com/2025/04/event-versioning-strategies-for-event-driven-architectures/ — JSON Schema vs Zod format trade-offs
- https://github.com/openai/openai-agents-js/issues/175 — signal handler SDK pitfall precedent

### Tertiary (informational)
- https://hono.dev/docs/helpers/streaming — Hono SSE `streamSSE` API
- https://nodejs.org/api/esm.html — ESM module cache behavior (platform invariant)
- https://levelup.gitconnected.com/hono-vs-express-vs-fastify-the-2025-architecture-guide-for-next-js-5a13f6e12766 — Hono vs Express vs Fastify performance comparison

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
