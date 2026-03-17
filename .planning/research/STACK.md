# Technology Stack

**Project:** Agent Bus v1.2 — Developer Experience
**Researched:** 2026-03-17
**Scope:** NEW capabilities only — SDK/library mode, event schema registry, web dashboard, plugin adapter system. Zod ^4.3.6, pino ^9.14.0, @modelcontextprotocol/sdk ^1.27.1, yaml, TypeScript, and node:sqlite are already in place and NOT re-researched.

---

## Summary

Three of the four v1.2 features require zero new dependencies. SDK/library mode, event schema registry, and the plugin adapter system are all built from what is already present: Zod v4's built-in `z.toJSONSchema()` and `z.registry()` cover the schema registry, the `package.json` `"exports"` field and existing `startDaemon`/`AgentBusDaemon` interface cover SDK mode, and the existing `registry.ts` switch pattern can be extended into a plugin contract without adding a loader library. Only the web dashboard requires adding a new dependency.

The current `"type": "module"` project structure and Node.js 22.12+ runtime support everything needed without introducing a build pipeline or transpilation step for the dashboard.

---

## Feature-by-Feature Stack Decisions

### 1. SDK/Library Mode

**Decision: No new dependency. Add `"exports"` field to `package.json` and a public `src/index.ts` entry point.**

`startDaemon()` and `AgentBusDaemon` in `src/daemon/index.ts` already constitute a well-shaped programmatic API. The daemon accepts injected loggers, monitors, database paths, and signal handler opt-outs. What is missing is a stable, documented public surface.

**Implementation path:**
- Add `"main"` and `"exports"` fields to `package.json` pointing to `dist/index.js` and `dist/index.d.ts` for TypeScript consumers.
- Create `src/index.ts` that re-exports `startDaemon`, `AgentBusDaemon`, domain types (`EventEnvelope`, `ArtifactRef`), schema types (`AgentBusManifest`), and contract types (`AdapterWorkPackage`, `AdapterResultEnvelope`).
- Do NOT export storage internals, delivery store primitives, or daemon-internal helpers. Public API = `startDaemon` + types only.
- `registerSignalHandlers: false` option already exists for embedding scenarios. Expose this clearly in SDK docs.

**Node.js API used:** `"exports"` field in `package.json` — built into Node.js module resolution, no library. TypeScript `declaration: true` already configured in `tsconfig.json`.

**Confidence: HIGH** — `startDaemon` and `AgentBusDaemon` examined directly; `"exports"` field is a Node.js standard.

---

### 2. Event Schema Registry

**Decision: No new dependency. Use Zod v4's built-in `z.registry()` and `z.toJSONSchema()`.**

Zod v4 (currently `^4.3.6` already in `dependencies`) ships:
- `z.registry<Meta>()` — creates a typed schema registry associating schemas with metadata (title, description, examples, etc.).
- `z.globalRegistry` — a built-in global registry that `.describe()` populates automatically.
- `z.toJSONSchema(schema, options?)` — built-in JSON Schema conversion. No `zod-to-json-schema` package needed. As of Zod v4 release (2025), `zod-to-json-schema` is officially deprecated in favor of this.

**Why Zod v4 over a dedicated schema registry library:**
- Already a dependency — zero delta.
- `z.toJSONSchema()` produces Draft 2020-12 JSON Schema natively.
- Schemas registered in the manifest already use Zod (`AgentBusManifestSchema`, `EventEnvelopeSchema`). The topic-level payload schemas fit naturally alongside these.
- Type inference works across the registry — schema consumers get TypeScript types automatically.

**Implementation path:**
- Add an optional `schemas` section to `agent-bus.yaml` manifest (`topic: "plan.created"`, `payloadSchema: ZodObject`).
- OR allow programmatic registration via `agentBus.registerTopicSchema(topic, zodSchema)` in SDK mode.
- At publish time, validate `event.payload` against the registered schema for the topic if one exists.
- Validation failure → `ZodError` → publisher receives structured validation error before the event is persisted.
- Expose `agentBus.getTopicSchema(topic)` returning the schema and its JSON Schema equivalent (`z.toJSONSchema(schema)`).

**What NOT to do:** Do not add `ajv`, `json-schema`, or a dedicated schema registry service. Zod is already present and its v4 feature set covers this exactly.

**Confidence: HIGH** — Zod v4 `z.toJSONSchema()` and `z.registry()` verified against official Zod v4 release notes (zod.dev/v4). Feature confirmed shipped in November 2025 stable release.

---

### 3. Web Dashboard

**Decision: Add `hono` ^4.12.8 and `@hono/node-server` ^1.19.11 as new production dependencies. Serve inline HTML/CSS/JS with no frontend build step.**

**Why Hono:**
- Ultralight HTTP framework (7.6 kB gzipped, zero external dependencies of its own). Fits the project's minimal-dependency philosophy.
- Web Standards-first (Request/Response API) — runs natively on Node.js 18+ via `@hono/node-server` adapter.
- Serves JSON APIs (runs, deliveries, approvals) and static HTML from the same Hono app instance.
- `serveStatic` middleware available from `@hono/node-server/serve-static` for static file serving if assets grow.
- ESM-compatible, TypeScript-first.
- Fastest lightweight option verified: 3.5x faster than Express, smaller than Fastify (2.8 MB) at 1.4 MB unpacked.

**Why NOT Express or Fastify:**
- Express has no active maintainers and is not ESM-native.
- Fastify is heavier (2.8 MB unpacked, 178 kB gzipped) and designed for high-throughput APIs — overkill for a local operator dashboard.

**Why NOT a React/Preact/Svelte SPA with a build step:**
- Adds Vite, a bundler, and a full frontend build pipeline. This is a local operator dashboard, not a product UI.
- The dashboard is read-only telemetry: runs, deliveries, approvals, failures. A server-side HTML template is sufficient.
- `AgentBusDaemon` already has `listRunSummaries()`, `getRunDetail()`, `listPendingApprovalViews()`, `listFailureDeliveries()` — these map directly to HTML endpoints.

**Dashboard architecture:**
- Hono app embedded in the daemon, started alongside the MCP server.
- Serves: `GET /` (run list), `GET /runs/:runId` (run detail), `GET /approvals` (pending approvals), `GET /failures` (dead-letter + retry queue).
- Returns HTML with inline CSS for non-JS rendering. Optionally adds `htmx.min.js` (CDN-loaded) for live refresh without a build step.
- Dashboard port separate from MCP port. Inject `AGENT_BUS_DASHBOARD_URL` as informational output on daemon start.
- Protected by localhost binding only — no auth needed (same model as MCP server).

**htmx consideration:**
- htmx (loaded from CDN, not a dependency) enables partial HTML updates for live dashboards without writing JavaScript or bundling.
- This is optional and can be added in a later iteration. V1.2 baseline = static HTML, polling refresh via `<meta http-equiv="refresh">` tag if live updates are wanted.

**Versions confirmed:**
- `hono` 4.12.8 — confirmed via npm registry (last published 3 hours before research date).
- `@hono/node-server` 1.19.11 — confirmed via npm registry (last published 2 days before research date).

**Confidence: HIGH** — versions pulled from live npm registry search results. Hono architecture verified against official docs.

---

### 4. Plugin Adapter System

**Decision: No new dependency. Extend the existing `registry.ts` pattern with a `PluginAdapterContract` interface and ESM dynamic `import()` for user-provided adapters.**

The current adapter system in `src/adapters/registry.ts` uses a static `runtimeDefinitions` map and a `switch` in `buildAdapterCommand()`. The manifest's `agent.runtime` field is validated against a `SupportedRuntimeFamilySchema` Zod enum. This locks out third-party adapters.

**Plugin system design:**
- Define a `PluginAdapterContract` interface in `src/adapters/plugin-contract.ts`:
  - `family: string` — unique identifier matching `agent.runtime` values.
  - `displayName: string`
  - `executableCandidates: readonly string[]`
  - `executionMode: "non_interactive_cli" | "editor_cli"`
  - `buildCommand(input: BuildAdapterCommandInput): PreparedAdapterCommand` — adapter-specific command builder.
- Change `SupportedRuntimeFamilySchema` from a closed Zod `z.enum([...])` to a `z.string().min(1)` on the manifest, with known families validated at runtime against the registry.
- Built-in adapters (codex, gemini, open-code, claude-code) implement `PluginAdapterContract` — they become first-class plugins internally.
- Plugin loading: manifest can specify `plugins: [{ path: "./my-adapter.js" }]`. On daemon start, each plugin path is loaded via ESM `await import(path.resolve(repositoryRoot, pluginPath))` and its default export validated against `PluginAdapterContract`.
- Register loaded plugins into a runtime registry (`Map<string, PluginAdapterContract>`) that replaces the static `runtimeDefinitions` object.

**Why no plugin loader library (`pluginify`, `live-plugin-manager`, etc.):**
- ESM `import()` is built into Node.js and sufficient for file-path-based plugins in a local-first tool.
- This is NOT an npm-package plugin ecosystem — it's local adapter scripts for teams or individual users. Dynamic `import()` is the right primitive.
- A loader library would add complexity and version coupling for a rare code path.

**Why no `@ts-morph` or type-generation tooling:**
- Plugin authors write TypeScript or JavaScript. The `PluginAdapterContract` interface is the contract — plugins implement it, consumers call it through the interface. No code generation needed.

**ESM dynamic import note:** Node.js 22+ supports `import()` of `.js`, `.mjs`, and ESM `.ts` (with `--experimental-strip-types`). Plugin adapters are expected to be pre-built `.js` files or source TypeScript when the consumer's project compiles them.

**Confidence: HIGH** — pattern derived from analysis of existing `registry.ts`; ESM `import()` is a Node.js 22+ built-in.

---

## Full Dependency Delta for v1.2

### Production Dependencies to Add

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `hono` | `^4.12.8` | HTTP framework for web dashboard routes | Minimal (zero deps, 7.6 kB gz), Web Standards API, ESM-native |
| `@hono/node-server` | `^1.19.11` | Node.js adapter for Hono | Required to run Hono on Node.js; separate from core hono package |

### Existing Dependencies (already present, leveraged for new features)

| Package | Current Version | New v1.2 Usage |
|---------|-----------------|----------------|
| `zod` | `^4.3.6` | `z.registry()`, `z.toJSONSchema()` for event schema registry |
| `@modelcontextprotocol/sdk` | `^1.27.1` | No change — already handles MCP server |
| `pino` | `^9.14.0` | No change — already handles structured logging |
| `yaml` | `^2.8.2` | No change — manifest loading |

### Dev Dependencies (no additions needed)

| Package | Current Version | Status |
|---------|-----------------|--------|
| `@types/node` | `^22.15.30` | No change |
| `typescript` | `^5.9.3` | No change |

### NOT Adding

| What | Why Not |
|------|---------|
| `express` / `fastify` | Heavier than Hono; Express is not ESM-native; Fastify is overkill for local dashboard |
| `react` / `preact` / `svelte` | Adds build pipeline (Vite) to a local operator tool — unjustified complexity |
| `vite` / bundler | No frontend build step is the explicit goal for dashboard |
| `ajv` / `json-schema` libraries | Zod v4 `z.toJSONSchema()` replaces need for external JSON Schema tools |
| `zod-to-json-schema` | Deprecated as of Zod v4 stable release (November 2025) |
| `live-plugin-manager` / `pluginify` | ESM `import()` is sufficient for file-path-based local adapter plugins |
| `p-queue` / `p-limit` | Not needed — plugin loading is one-time at daemon start |
| `htmx` (npm) | Use CDN script tag in dashboard HTML; not a production dependency |

---

## Integration Points

### SDK/Library Mode → package.json + src/index.ts
```
package.json "exports": { ".": "./dist/index.js" }
src/index.ts → re-exports startDaemon, AgentBusDaemon, domain types, schema types
Consumers: import { startDaemon } from "agent-bus"
```

### Event Schema Registry → Zod v4 + publishEvent pipeline
```
user registers: agentBus.registerTopicSchema("plan.created", z.object({ ... }))
publishEvent() → look up registry → z.safeParse(envelope.payload) → reject if ZodError
agentBus.getTopicSchema(topic) → { schema: ZodSchema, jsonSchema: z.toJSONSchema(schema) }
```

### Web Dashboard → Hono embedded in daemon startup
```
startDaemon() → createDashboardServer({ daemon, port }) → Hono app bound to localhost:port
Routes: GET / → HTML run list | GET /runs/:id → run detail | GET /approvals | GET /failures
daemon.stop() → dashboardServer.stop() (in parallel with MCP server stop)
```

### Plugin Adapter System → ESM dynamic import + registry Map
```
manifest plugins[]: [{ path: "./adapters/my-agent.js" }]
startDaemon() → loadPlugins(manifest.plugins, repositoryRoot) → import(path) → validate contract
adapterRegistry = new Map([...builtins, ...plugins])
buildAdapterCommand() → adapterRegistry.get(agent.runtime)?.buildCommand(input) ?? generic
```

---

## Node.js 22+ Built-ins Leveraged (New for v1.2)

| Feature | Node.js API | Used For |
|---------|------------|---------|
| ESM dynamic import | `import()` | Plugin adapter loading at daemon start |
| Module exports resolution | `package.json "exports"` field | SDK/library mode entry point |

---

## Pre-Implementation Verification Checklist

Before coding begins, verify:

- [ ] `hono` 4.x `@hono/node-server` 1.x confirmed compatible with Node.js 22.12+ (requires Node >= 18; >=22 confirmed fine)
- [ ] `z.toJSONSchema()` import path in Zod v4: verify `import { z } from "zod"` then `z.toJSONSchema(schema)` — no sub-package import needed
- [ ] `z.registry()` type signature confirmed from `zod.dev/metadata` docs
- [ ] Hono app `serve()` from `@hono/node-server` binds with `{ port: 0 }` for OS-assigned ephemeral port (same pattern as MCP server)
- [ ] ESM `import(filePath)` of a `.js` plugin works from within compiled `dist/` without `--loader` flags on Node.js 22.12+
- [ ] `package.json "exports"` field supports `"types"` subfield for TypeScript consumers without `moduleResolution: bundler`

---

## Sources

- Zod v4 release notes: https://zod.dev/v4 (HIGH confidence — official docs)
- Zod metadata and registries: https://zod.dev/metadata (HIGH confidence — official docs)
- Zod JSON Schema: https://zod.dev/json-schema (HIGH confidence — official docs)
- Hono npm: https://www.npmjs.com/package/hono — version 4.12.8 confirmed (HIGH confidence)
- @hono/node-server npm: https://www.npmjs.com/package/@hono/node-server — version 1.19.11 confirmed (HIGH confidence)
- Hono Node.js docs: https://hono.dev/docs/getting-started/nodejs (HIGH confidence — official docs)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/adapters/registry.ts` (adapter plugin integration point)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/daemon/index.ts` (SDK mode integration point)
- Source analysis: `/Users/macbook/Data/Projects/agent-bus/src/domain/event-envelope.ts` (schema registry integration point)
- Project context: `/Users/macbook/Data/Projects/agent-bus/.planning/PROJECT.md`
