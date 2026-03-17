# Phase 9: Web Dashboard - Research

**Researched:** 2026-03-17
**Domain:** Hono HTTP server, Server-Sent Events, vanilla HTML/JS dashboard, TypeScript ESM Node.js
**Confidence:** HIGH

## Summary

Phase 9 adds a read-only operator dashboard served by the Hono HTTP framework alongside the existing MCP server. The daemon gains a second HTTP server that exposes JSON API endpoints (backed by the already-complete `operator-service.ts`) and an SSE endpoint for real-time push updates. The browser-side is a single HTML file with inline vanilla JS and CSS — no build pipeline, no bundler.

The primary technical challenge is the SSE lifecycle: the Hono `streamSSE` callback must stay alive using a `while(true)` loop or a Promise that resolves on server shutdown, and open SSE connections must be force-closed before `daemon.stop()` can resolve. The dispatcher has no EventEmitter today — a lightweight emitter must be added so delivery/approval state changes propagate to SSE connections without polling.

`createAdaptorServer` from `@hono/node-server` is the right entry point because it returns a raw `node:http.Server` handle, enabling the same ephemeral-port-binding and `server.close()` pattern already used for the MCP server.

**Primary recommendation:** Use `createAdaptorServer` (not `serve`), bind with `server.listen(port ?? 0, '127.0.0.1')`, track open SSE `AbortController` handles in a `Set`, and on shutdown: abort all tracked controllers, then call `server.closeAllConnections()` and `server.close()`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Page structure**
- Single scrollable page with three sections, no tabs or sidebar navigation
- Attention-first ordering: Pending Approvals → Failures → Runs
- Compact run rows: truncated run ID, status badge, delivery count (completed/total), relative timestamp — one line per run
- Empty sections auto-hidden by default; "Show all sections" toggle reveals them

**Run detail view**
- Clicking a run row expands it inline (no page navigation)
- Expanded view shows: Deliveries with state, Events list, Error messages for failed deliveries, Approval status
- Subsections (Deliveries/Events/Approvals) all visible when expanded — not individually collapsible
- Clicking a failure row scrolls to the parent run and expands it with the failed delivery highlighted

**Visual styling**
- Dark terminal aesthetic: dark background (#1a1a2e / #16213e), monospace font, muted text (#e0e0e0)
- Cards/rows use slightly lighter background (#1e293b) with subtle dark borders
- Delivery state colors: completed → green (#4ade80), in_progress/leased → blue (#60a5fa), attention/retry → amber (#fbbf24), dead_letter → red (#f87171), ready → gray (#9ca3af), pending_approval → gray outline, cancelled → dim
- Minimal header: "Agent Bus" title + SSE connection status indicator (green dot = live)
- Timestamps displayed as relative ("3m ago", "1h ago") — updated periodically via JS

**SSE update behavior**
- Granular SSE event types:
  - `delivery.state_changed` — { deliveryId, runId, agentId, oldState, newState }
  - `approval.created` — { approvalId, eventId, runId, topic }
  - `approval.decided` — { approvalId, status, decidedBy }
  - `event.published` — { eventId, runId, topic }
- Changed rows get a brief highlight flash animation (amber glow, 1-2s) then settle
- New runs auto-insert at top of the Runs list
- Auto-reconnect on SSE disconnect with exponential backoff (3-5s retry)
- Connection indicator reflects state: [● live] → [○ disconnected] → [◦ reconnecting...]
- On reconnect, full page data refresh to catch up on missed events

**Technology**
- Hono + `@hono/node-server` (only new npm deps in v1.2)
- Read-only dashboard — approve/reject stays in CLI
- No authentication (localhost-only)
- Plain HTML + vanilla JS, no build pipeline (DASH-08)

### Claude's Discretion
- Exact CSS animations and transitions
- Hono route structure and middleware
- How to add EventEmitter hooks to dispatcher for SSE (STATE.md notes this needs investigation)
- HTML template structure and vanilla JS organization
- SSE keepalive interval
- How many runs to show by default (pagination/limit)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Hono HTTP server starts with daemon, bound to localhost | `createAdaptorServer` pattern; same port-binding approach as MCP server |
| DASH-02 | Dashboard displays list of runs with status summary | `operatorService.listRunSummaries()` → `GET /api/runs` → HTML render |
| DASH-03 | Dashboard displays delivery details per run (state, agent, timing) | `operatorService.getRunDetail()` → inline expand on run row click |
| DASH-04 | Dashboard displays pending approval queue | `operatorService.listPendingApprovalViews()` → top section |
| DASH-05 | Dashboard displays failure/dead-letter queue | `operatorService.listFailureDeliveries()` → second section |
| DASH-06 | SSE endpoint pushes delivery lifecycle events in real time | Dispatcher EventEmitter extension + `streamSSE` endpoint |
| DASH-07 | Dashboard UI updates live via SSE without manual refresh | Vanilla JS `EventSource` consuming typed SSE events |
| DASH-08 | Dashboard served as plain HTML + vanilla JS (no build pipeline) | Single HTML template with inline `<script>` and `<style>` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | ^4.12.8 | HTTP routing, request/response handling, `streamSSE` helper | Web-standards API, works identically on Node.js and edge runtimes; tree-shakeable |
| `@hono/node-server` | ^1.19.11 | Adapts Hono's fetch-based handler to `node:http`; exposes raw `http.Server` | Required adapter for Node.js; `createAdaptorServer` gives low-level server control needed for shutdown |

### Existing (no new deps)
| Module | Purpose |
|--------|---------|
| `node:events` (EventEmitter) | Dispatcher event bus for SSE fan-out — already in Node.js stdlib |
| `node:http` | Underlying server type returned by `createAdaptorServer` |
| `pino` (already installed) | Dashboard server log lines follow existing pino structured pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `createAdaptorServer` + manual listen | `serve()` function | `serve()` doesn't expose the `http.Server` handle synchronously at startup; harder to capture port for ephemeral binding |
| `node:events` EventEmitter | `@hono/event-emitter` | Adds a dep; Node.js built-in is sufficient for this use case |
| Single HTML file inline | Separate `.html` / `.js` / `.css` files | Separate files need static file serving middleware; inline keeps it DASH-08 compliant with zero extra plumbing |

**Installation:**
```bash
npm install hono @hono/node-server
```

---

## Architecture Patterns

### Recommended File Structure
```
src/
├── daemon/
│   ├── index.ts                # Add dashboardPort option, dashboardUrl, stop integration
│   ├── dispatcher.ts           # Add EventEmitter for SSE fan-out
│   ├── dashboard-server.ts     # NEW: Hono app + createAdaptorServer + SSE endpoint
│   └── dashboard-html.ts       # NEW: Returns the single HTML string (template literal)
```

### Pattern 1: Server Startup with Ephemeral Port (mirrors MCP server)

`createAdaptorServer` returns a raw `http.Server`. Call `.listen(port ?? 0, '127.0.0.1')` — same pattern used by `mcp-server.ts`.

```typescript
// Source: https://github.com/honojs/node-server
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";

export interface DashboardServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

export async function createDashboardServer(options: {
  operatorService: OperatorService;
  dashboardEmitter: DashboardEmitter;
  port?: number;
}): Promise<DashboardServerHandle> {
  const app = buildHonoApp(options);
  const httpServer = createAdaptorServer(app);

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.once("listening", () => {
      const addr = httpServer.address() as AddressInfo;
      resolve(addr.port);
    });
    httpServer.listen(options.port ?? 0, "127.0.0.1");
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      // 1. Abort all open SSE connections (unblocks their while-loops)
      options.dashboardEmitter.closeAll();
      // 2. Stop accepting new connections, wait for in-flight requests
      await new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      });
    }
  };
}
```

### Pattern 2: Dispatcher EventEmitter Extension

The dispatcher currently records notifications imperatively. A second "emitter" layer is needed alongside the existing notification array — it must NOT replace the array (delivery-service and other callers still use `dispatcher.snapshot()`).

```typescript
// In dispatcher.ts — add alongside existing recordNotification
import { EventEmitter } from "node:events";

export type DashboardEventType =
  | "delivery.state_changed"
  | "approval.created"
  | "approval.decided"
  | "event.published";

export interface DashboardEvent {
  type: DashboardEventType;
  payload: Record<string, unknown>;
}

// createDispatcher returns an emitter alongside existing snapshot()
// Usage: dispatcher.emitter.on("dashboard", (event: DashboardEvent) => { ... })
```

The simplest approach: add `readonly emitter: EventEmitter` to the return of `createDispatcher`, emit on every `handle*` call. Callers that only use `snapshot()` are unaffected.

### Pattern 3: SSE Endpoint with Fan-out and Shutdown Safety

The critical correctness requirement is DASH-08 shutdown: SSE connections must not block `daemon.stop()`.

```typescript
// Source: https://hono.dev/docs/helpers/streaming
import { streamSSE } from "hono/streaming";

app.get("/events", (c) => {
  const controller = new AbortController();
  activeControllers.add(controller);

  return streamSSE(c, async (stream) => {
    stream.onAbort(() => {
      activeControllers.delete(controller);
      controller.abort();
    });

    // Send initial snapshot so client is current immediately on connect
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify(buildSnapshot(operatorService))
    });

    // Wait for events or shutdown signal
    await new Promise<void>((resolve) => {
      const handler = (event: DashboardEvent) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event.payload) });
      };
      dashboardEmitter.on("dashboard", handler);
      controller.signal.addEventListener("abort", () => {
        dashboardEmitter.off("dashboard", handler);
        resolve();
      });
    });
  });
});

// Shutdown: abort all active controllers — resolves all pending SSE Promises
function closeAll() {
  for (const ctrl of activeControllers) ctrl.abort();
  activeControllers.clear();
}
```

### Pattern 4: HTML Response as Template Literal

Serve the entire dashboard as a single string from a `GET /` route. No static file serving needed.

```typescript
app.get("/", (c) => {
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(getDashboardHtml());
});
```

`getDashboardHtml()` returns a template literal with inline `<style>` and `<script>`. The `<script>` block contains the `EventSource` setup, DOM update handlers, and reconnect logic.

### Pattern 5: Vanilla JS EventSource with Auto-reconnect

```javascript
// Inside the inline <script> block
function connect() {
  const es = new EventSource("/events");
  let retryMs = 3000;

  es.addEventListener("snapshot", (e) => {
    renderAll(JSON.parse(e.data));
    retryMs = 3000; // reset backoff on successful connect
    setIndicator("live");
  });

  es.addEventListener("delivery.state_changed", (e) => {
    const payload = JSON.parse(e.data);
    updateDeliveryRow(payload);
    flashRow(payload.deliveryId);
  });

  // ... other typed event listeners

  es.onerror = () => {
    setIndicator("disconnected");
    es.close();
    setTimeout(() => {
      setIndicator("reconnecting");
      connect();
      retryMs = Math.min(retryMs * 2, 30000);
    }, retryMs);
  };
}
```

The browser `EventSource` natively reconnects, but this manual pattern gives control over the reconnect indicator and backoff (as specified in CONTEXT.md).

### Anti-Patterns to Avoid

- **Using `serve()` instead of `createAdaptorServer()`:** `serve()` starts listening immediately and only exposes the port via callback, not the `http.Server` object needed for `closeAllConnections()`.
- **Polling dispatcher.snapshot() for SSE:** Race-prone and burns CPU. Add an emitter, push on state change.
- **Returning from `streamSSE` callback immediately:** The SSE connection closes as soon as the callback returns. Must block on a Promise (abort signal, sleep loop, or similar).
- **Forgetting `stream.onAbort()` cleanup:** EventEmitter listener leaks if client disconnects and the handler is not removed.
- **Using `server.close()` alone without aborting SSE connections:** `server.close()` stops new connections but does NOT close existing long-lived SSE connections. Call `closeAll()` first, then `closeAllConnections()` and `close()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE response formatting | Custom `data: ...\n\n` string building | `streamSSE` from `hono/streaming` | Handles framing, flush, connection headers automatically |
| HTTP routing | Custom request dispatcher | `new Hono()` with `.get()` / `.use()` | Routing with zero ceremony, fully typed context |
| HTML escaping in JSON response | Manual escaping | `JSON.stringify()` for data payloads | SSE data is JSON strings, not raw HTML |
| Relative timestamps | Custom time formatter | Simple JS function (`Date.now() - createdAt`) — 10 lines | No library needed; update periodically with `setInterval` |
| SSE reconnect with backoff | Custom WebSocket-like protocol | `EventSource` + manual `onerror` retry | Browser native, simple |

**Key insight:** The data layer (`operator-service.ts`) is already complete. This phase is almost entirely plumbing (server lifecycle) and presentation (HTML/CSS/JS).

---

## Common Pitfalls

### Pitfall 1: SSE Connection Blocks daemon.stop()
**What goes wrong:** `daemon.stop()` calls `server.close()` but SSE connections hold open TCP sockets. The promise never resolves.
**Why it happens:** `http.Server.close()` stops accepting new connections but does not terminate existing ones. SSE connections are persistent by design.
**How to avoid:** Track every SSE `AbortController` in a module-level `Set`. In `dashboardServer.stop()`, iterate the set, call `.abort()` on each, then call `httpServer.closeAllConnections()` before `httpServer.close()`.
**Warning signs:** `await daemon.stop()` hangs in tests; process doesn't exit after SIGINT.

### Pitfall 2: streamSSE Callback Returns Immediately
**What goes wrong:** SSE connection opens and closes in milliseconds. Browser sees disconnected immediately.
**Why it happens:** Hono closes the stream when the async callback resolves. Without a blocking await, it returns right away.
**How to avoid:** Block the callback with `await new Promise<void>((resolve) => { signal.addEventListener('abort', resolve); })`. This Promise stays pending until the abort signal fires (on client disconnect or server shutdown).
**Warning signs:** Browser EventSource fires `onerror` immediately after connecting; Network tab shows response with `Connection: close`.

### Pitfall 3: EventEmitter Listener Leak on Client Disconnect
**What goes wrong:** Each SSE connection registers a listener on the dispatcher emitter. When clients disconnect, listeners accumulate. Node.js emits `MaxListenersExceededWarning`.
**Why it happens:** `stream.onAbort()` not called, or called but listener removal code missing.
**How to avoid:** Always pair `emitter.on(handler)` with a corresponding `emitter.off(handler)` inside `stream.onAbort()`.
**Warning signs:** `(node:XXXXX) MaxListenersExceededWarning` in stderr; memory grows with each browser refresh.

### Pitfall 4: exactOptionalPropertyTypes Strictness
**What goes wrong:** TypeScript errors when constructing objects where optional fields must be absent (not `undefined`) to match `exactOptionalPropertyTypes`.
**Why it happens:** `tsconfig.json` has `"exactOptionalPropertyTypes": true`. This is stricter than typical TypeScript.
**How to avoid:** Use conditional spread `...(value !== undefined ? { field: value } : {})` — same pattern already used throughout the codebase.
**Warning signs:** TS error: `Type 'undefined' is not assignable to type 'string'` on optional fields.

### Pitfall 5: Hono Type Mismatch with exactOptionalPropertyTypes
**What goes wrong:** Hono's internal types may not be compatible with `exactOptionalPropertyTypes`, similar to the MCP SDK issue in `mcp-server.ts`.
**Why it happens:** Third-party library types frequently use optional params typed as `T | undefined` which is stricter than `T?` under this mode.
**How to avoid:** Use `as unknown as ExpectedType` cast (existing pattern in `mcp-server.ts` line 124) when library types conflict.
**Warning signs:** TypeScript error referencing Hono internals. Look for `as unknown as` cast pattern used in MCP server.

### Pitfall 6: verbatimModuleSyntax and ESM Import Paths
**What goes wrong:** TypeScript errors on `import type` vs `import` or missing `.js` extensions.
**Why it happens:** `verbatimModuleSyntax: true` + `module: NodeNext` requires explicit `.js` extensions and `import type` for type-only imports.
**How to avoid:** All new files follow existing pattern: `.js` extensions on all relative imports, `import type` for type-only imports.
**Warning signs:** `TS1286` or module resolution errors at build time.

---

## Code Examples

### Starting Dashboard Server (following mcp-server.ts pattern)
```typescript
// Source: Mirrors /Users/macbook/Data/Projects/agent-bus/src/daemon/mcp-server.ts
import { createAdaptorServer } from "@hono/node-server";
import type { AddressInfo } from "node:net";

const httpServer = createAdaptorServer(app);

function listenDashboardServer(server: ReturnType<typeof createAdaptorServer>, port?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
    server.listen(port ?? 0, "127.0.0.1");
  });
}
```

### Hono JSON API Route
```typescript
// Source: https://hono.dev/docs/getting-started/nodejs
app.get("/api/runs", (c) => {
  const runs = operatorService.listRunSummaries(50);
  return c.json(runs);
});

app.get("/api/runs/:runId", (c) => {
  const detail = operatorService.getRunDetail(c.req.param("runId"));
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});
```

### streamSSE with Lifecycle Management
```typescript
// Source: https://hono.dev/docs/helpers/streaming
import { streamSSE } from "hono/streaming";

app.get("/events", (c) => {
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    activeControllers.add(controller);

    stream.onAbort(() => {
      activeControllers.delete(controller);
      controller.abort();
    });

    // Snapshot on connect
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify(buildFullSnapshot())
    });

    // Block until abort
    await new Promise<void>((resolve) => {
      const onDashboardEvent = (evt: DashboardEvent) => {
        void stream.writeSSE({ event: evt.type, data: JSON.stringify(evt.payload) });
      };
      emitter.on("dashboard", onDashboardEvent);
      controller.signal.addEventListener("abort", () => {
        emitter.off("dashboard", onDashboardEvent);
        resolve();
      }, { once: true });
    });
  });
});
```

### Dispatcher EventEmitter Addition
```typescript
// Source: src/daemon/dispatcher.ts — additive change only
import { EventEmitter } from "node:events";

export type DashboardEventType =
  | "delivery.state_changed"
  | "approval.created"
  | "approval.decided"
  | "event.published";

// Inside createDispatcher():
const dashboardEmitter = new EventEmitter();

// After each recordNotification call that maps to a dashboard event type,
// emit on dashboardEmitter:
dashboardEmitter.emit("dashboard", {
  type: "delivery.state_changed",
  payload: { deliveryId, runId, agentId, oldState, newState }
});

// Return dashboardEmitter from createDispatcher so dashboard server can listen
```

### Daemon Integration (daemon/index.ts)
```typescript
// StartDaemonOptions — add:
readonly dashboardPort?: number;

// AgentBusDaemon — add:
readonly dashboardUrl: string;

// In startDaemon():
const dashboardServer = await createDashboardServer({
  operatorService,
  dispatcher,           // dispatcher now has .emitter
  port: options.dashboardPort
});
options.logger?.info({ event: "dashboard.started", dashboardUrl: dashboardServer.url });

// In stop():
await dashboardServer.stop();
await mcpServer.stop();
database.close();
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `node:http` for internal servers | Hono + `@hono/node-server` | v1.2 (this phase) | Structured routing, typed middleware, `streamSSE` helper |
| No live dashboard | SSE-driven HTML dashboard | v1.2 (this phase) | Operators no longer need CLI for run visibility |
| `serve()` function | `createAdaptorServer()` | Preferred for daemon use | Gives raw `http.Server` needed for controlled shutdown |

**Deprecated/outdated:**
- `serve()` from `@hono/node-server`: Not deprecated, but unsuitable here — use `createAdaptorServer` instead for access to `httpServer.closeAllConnections()` and `httpServer.address()`.

---

## Open Questions

1. **Dispatcher emitter call sites**
   - What we know: `dispatcher.ts` has `handlePersistedEvent`, `handlePendingApproval`, `handleReadyDelivery` — all three need SSE emission
   - What's unclear: `approval.decided` event — this fires in `approval-service.ts`, not dispatcher. Need to verify whether dispatcher is the right place to emit or whether approval-service needs its own emitter hook.
   - Recommendation: Read `approval-service.ts` before designing the emitter interface. If approval decisions don't flow through dispatcher, add a second callback or expand the emitter to be passed into approval-service as well.

2. **SSE keepalive interval**
   - What we know: Some proxies and load balancers cut SSE connections idle > 60s
   - What's unclear: Whether the daemon is always accessed direct (no proxy) on localhost
   - Recommendation: Add a 30s `keepalive` comment ping (`await stream.writeSSE({ data: ": keepalive" })`). Claude's discretion per CONTEXT.md.

3. **Default run limit**
   - What we know: `operatorService.listRunSummaries(limit)` defaults to 20
   - What's unclear: Whether 20 is the right default for the dashboard
   - Recommendation: Use 50 for the dashboard (more useful for monitoring). Claude's discretion per CONTEXT.md.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no separate framework) |
| Config file | None — tests run via `node --experimental-sqlite --test dist/test/**/*.test.js` |
| Quick run command | `npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Hono server starts on localhost, exposes URL | unit | `node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js` | Wave 0 |
| DASH-01 | Server stops cleanly via stop() | unit | same file | Wave 0 |
| DASH-02 | GET /api/runs returns run list JSON | unit | same file | Wave 0 |
| DASH-03 | GET /api/runs/:runId returns delivery details | unit | same file | Wave 0 |
| DASH-04 | GET /api/approvals returns pending approvals | unit | same file | Wave 0 |
| DASH-05 | GET /api/failures returns dead-letter deliveries | unit | same file | Wave 0 |
| DASH-06 | GET /events is text/event-stream; emits typed events | unit | same file | Wave 0 |
| DASH-07 | (Verified by DASH-06 + manual browser test) | manual | — | — |
| DASH-08 | GET / returns text/html with no external scripts | unit | same file | Wave 0 |
| DASH-08 (shutdown) | stop() resolves even with open SSE connections | unit | same file | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/daemon/dashboard-server.test.ts` — covers DASH-01 through DASH-08 (all unit-testable behaviors)

*(All other test infrastructure is already present — `node:test`, TypeScript build, existing test helpers in `test/daemon/`)*

---

## Sources

### Primary (HIGH confidence)
- `src/daemon/mcp-server.ts` — Verified existing pattern for HTTP server lifecycle (listen, stop, port capture)
- `src/daemon/dispatcher.ts` — Confirmed no EventEmitter today; additive emitter extension is safe
- `src/daemon/operator-service.ts` — Confirmed all four API methods exist and return correct types
- `src/daemon/index.ts` — Confirmed `StartDaemonOptions` / `AgentBusDaemon` extension points
- https://hono.dev/docs/helpers/streaming — `streamSSE` API, `writeSSE`, `onAbort`
- https://hono.dev/docs/getting-started/nodejs — `createAdaptorServer` usage, `serve` callback
- https://github.com/honojs/node-server — `createAdaptorServer` returns raw `http.Server`
- Node.js docs (built-in knowledge) — `http.Server.closeAllConnections()` added in Node 18.2+; project requires 22.12+

### Secondary (MEDIUM confidence)
- https://github.com/honojs/hono/issues/3104 — Confirmed `server.close()` alone insufficient for long-lived connections
- WebSearch results — Hono 4.12.8 and @hono/node-server 1.19.11 are current versions (March 2026)
- https://yanael.io/articles/hono-sse/ — Multi-client SSE + Set pattern for tracking active streams

### Tertiary (LOW confidence)
- `streamSSE` keeps the connection alive only with an infinite loop or blocking Promise — inferred from Issue #2050 and #2993 on honojs/hono; not in official docs verbatim

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Hono + @hono/node-server is the locked decision from STATE.md; versions verified via npm
- Architecture: HIGH — `mcp-server.ts` is a direct template; `operator-service.ts` API is complete
- SSE lifecycle: MEDIUM — Core patterns verified via official docs; `streamSSE` blocking Promise pattern inferred from GitHub issues but consistent with official abort docs
- Pitfalls: HIGH — `exactOptionalPropertyTypes` and `verbatimModuleSyntax` pitfalls confirmed by direct tsconfig read and existing codebase patterns

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (Hono releases frequently; versions current as of research date)
