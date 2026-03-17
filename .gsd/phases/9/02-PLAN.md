---
phase: 9
plan: 2
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - src/daemon/dashboard-server.ts
  - src/daemon/index.ts
  - src/cli/worker-command.ts
  - src/daemon/approval-service.ts
  - test/daemon/dashboard-server.test.ts
autonomous: true
requirements: [DASH-01, DASH-06, DASH-08]

must_haves:
  truths:
    - "GET /events returns text/event-stream content type"
    - "SSE endpoint sends initial snapshot event on connect"
    - "SSE endpoint pushes delivery.state_changed, approval.created, approval.decided, event.published events"
    - "Server stop() resolves even when SSE connections are open"
    - "Daemon starts dashboard server alongside MCP server and logs its URL"
    - "Worker CLI accepts --dashboard-port flag"
    - "Dashboard URL is printed in worker startup banner"
  artifacts:
    - path: "src/daemon/dashboard-server.ts"
      provides: "SSE endpoint with AbortController tracking and shutdown safety"
      contains: "streamSSE"
    - path: "src/daemon/index.ts"
      provides: "Dashboard server wired into daemon lifecycle"
      contains: "dashboardServer"
    - path: "src/cli/worker-command.ts"
      provides: "--dashboard-port CLI flag"
      contains: "dashboard-port"
  key_links:
    - from: "src/daemon/dashboard-server.ts"
      to: "dispatcher.dashboardEmitter"
      via: "emitter.on('dashboard', handler) inside streamSSE"
      pattern: "emitter\\.on.*dashboard"
    - from: "src/daemon/index.ts"
      to: "src/daemon/dashboard-server.ts"
      via: "createDashboardServer called in startDaemon"
      pattern: "createDashboardServer"
    - from: "src/daemon/index.ts"
      to: "daemon.stop()"
      via: "dashboardServer.stop() called before mcpServer.stop()"
      pattern: "dashboardServer\\.stop"
    - from: "src/daemon/approval-service.ts"
      to: "dispatcher.dashboardEmitter"
      via: "emit approval.decided event after approve/reject"
      pattern: "dashboardEmitter\\.emit.*approval\\.decided"
---
<!-- AUTO-GENERATED from .planning/phases/09-web-dashboard/09-02-PLAN.md by scripts/sync-planning-to-gsd.mjs. source-sha256: a52b44381f8b8f561c5d655e4fe84c217cf7c2b266c0da6a294fb2c45756c800. Edit the source file, not this projection. -->


<objective>
Add SSE endpoint with shutdown safety to the dashboard server, wire the dashboard into the daemon lifecycle, add --dashboard-port CLI flag, and emit approval.decided events from approval-service.

Purpose: Completes the real-time event pipeline from dispatcher/approval-service through SSE to browser clients. Ensures clean shutdown even with open SSE connections (DASH-08 success criterion).
Output: Dashboard server fully integrated into daemon with working SSE push, ready for HTML UI in plan 03.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.gsd/SPEC.md
@.gsd/ROADMAP.md
@.gsd/STATE.md
@.gsd/phases/9/CONTEXT.md
@.gsd/phases/9/RESEARCH.md
@.gsd/phases/9/01-SUMMARY.md

@src/daemon/dashboard-server.ts
@src/daemon/index.ts
@src/cli/worker-command.ts
@src/daemon/approval-service.ts
@src/daemon/mcp-server.ts

<interfaces>
<!-- From plan 01 output — dashboard-server.ts exports -->
From src/daemon/dashboard-server.ts (created in plan 01):
```typescript
export interface DashboardServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}
export function createDashboardServer(options: {
  operatorService: ReturnType<typeof createOperatorService>;
  dashboardEmitter: DashboardEmitter;
  port?: number;
}): Promise<DashboardServerHandle>;
```

From src/daemon/dispatcher.ts (modified in plan 01):
```typescript
export type DashboardEventType = "delivery.state_changed" | "approval.created" | "approval.decided" | "event.published";
export interface DashboardEvent { readonly type: DashboardEventType; readonly payload: Record<string, unknown>; }
export type DashboardEmitter = EventEmitter<{ dashboard: [DashboardEvent] }>;
// createDispatcher now returns { ..., dashboardEmitter: DashboardEmitter }
```

From src/daemon/index.ts:
```typescript
export interface StartDaemonOptions {
  readonly mcpPort?: number;
  // dashboardPort will be added
  ...
}
export interface AgentBusDaemon {
  readonly mcpUrl: string;
  // dashboardUrl will be added
  ...
}
```

From src/daemon/approval-service.ts:
```typescript
export interface ApprovalServiceOptions {
  readonly dispatcher: Dispatcher;
  // dispatcher now has .dashboardEmitter
  ...
}
// approve() and reject() call dispatcher.handleReadyDelivery but do NOT emit approval.decided
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add SSE endpoint with shutdown safety and approval.decided emission</name>
  <files>src/daemon/dashboard-server.ts, src/daemon/approval-service.ts, test/daemon/dashboard-server.test.ts</files>
  <behavior>
    - Test: GET /events returns content-type text/event-stream
    - Test: SSE sends initial "snapshot" event with runs, approvals, failures data on connect
    - Test: When dashboardEmitter emits a "dashboard" event, SSE client receives the corresponding typed event
    - Test: stop() resolves within 1 second even when an SSE connection is open
    - Test: After SSE client disconnects, emitter listener is cleaned up (no leak)
    - Test: approval-service.approve() emits approval.decided event on dashboardEmitter
    - Test: approval-service.reject() emits approval.decided event on dashboardEmitter
  </behavior>
  <action>
    1. In `src/daemon/dashboard-server.ts`:
       - Add `import { streamSSE } from "hono/streaming";`
       - Add a module-level `Set<AbortController>` (`activeControllers`) inside the factory function scope
       - Add `GET /events` route using `streamSSE`:
         ```typescript
         app.get("/events", (c) => {
           return streamSSE(c, async (stream) => {
             const controller = new AbortController();
             activeControllers.add(controller);

             stream.onAbort(() => {
               activeControllers.delete(controller);
               controller.abort();
             });

             // Send initial snapshot
             const snapshot = {
               runs: operatorService.listRunSummaries(50),
               approvals: operatorService.listPendingApprovalViews(),
               failures: operatorService.listFailureDeliveries()
             };
             await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });

             // Block until abort — relay dashboard events to SSE
             await new Promise<void>((resolve) => {
               const handler = (evt: DashboardEvent) => {
                 void stream.writeSSE({ event: evt.type, data: JSON.stringify(evt.payload) });
               };
               dashboardEmitter.on("dashboard", handler);
               controller.signal.addEventListener("abort", () => {
                 dashboardEmitter.off("dashboard", handler);
                 resolve();
               }, { once: true });
             });
           });
         });
         ```
       - Add a 30-second keepalive comment ping using `setInterval` inside the SSE handler, cleared on abort (discretion per CONTEXT.md)
       - Update `stop()` to abort all active controllers before closing:
         ```typescript
         async stop() {
           for (const ctrl of activeControllers) ctrl.abort();
           activeControllers.clear();
           httpServer.closeAllConnections();
           await new Promise<void>((resolve) => {
             httpServer.close(() => resolve());
           });
         }
         ```

    2. In `src/daemon/approval-service.ts`:
       - The dispatcher object (passed via options) now has `dashboardEmitter` from plan 01
       - After the `approve()` method's `database.exec("COMMIT")` and the delivery loop, emit:
         ```typescript
         options.dispatcher.dashboardEmitter.emit("dashboard", {
           type: "approval.decided",
           payload: { approvalId: approval.approvalId, status: "approved", decidedBy: input.decidedBy }
         });
         ```
       - After the `reject()` method's `database.exec("COMMIT")`, emit:
         ```typescript
         options.dispatcher.dashboardEmitter.emit("dashboard", {
           type: "approval.decided",
           payload: { approvalId: approval.approvalId, status: "rejected", decidedBy: input.decidedBy }
         });
         ```

    3. Add SSE tests to `test/daemon/dashboard-server.test.ts`:
       - Test SSE connection: `fetch(url + "/events")`, verify content-type is `text/event-stream`
       - Test snapshot event: parse the first SSE frame, verify it contains runs/approvals/failures
       - Test event relay: emit a dashboard event on the emitter, verify the SSE client receives it
       - Test shutdown: open SSE connection, call stop(), verify stop resolves without hanging (use timeout)
       - Test listener cleanup: open SSE connection, abort the client fetch, verify emitter listenerCount("dashboard") returns to 0

    4. CRITICAL: The `streamSSE` callback MUST block on the abort Promise. If it returns immediately, the SSE connection closes. This is Pitfall 2 from RESEARCH.md.

    5. CRITICAL: `stream.onAbort()` MUST remove the emitter listener. This prevents listener leaks (Pitfall 3 from RESEARCH.md).
  </action>
  <verify>
    <automated>npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js</automated>
  </verify>
  <done>
    - SSE endpoint sends snapshot on connect and relays typed events
    - stop() resolves cleanly even with open SSE connections
    - No emitter listener leaks on client disconnect
    - approval-service emits approval.decided events
    - All tests pass
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire dashboard into daemon lifecycle and add CLI flag</name>
  <files>src/daemon/index.ts, src/cli/worker-command.ts</files>
  <action>
    1. In `src/daemon/index.ts`:
       - Add import: `import { createDashboardServer, type DashboardServerHandle } from "./dashboard-server.js";`
       - Add `readonly dashboardPort?: number;` to `StartDaemonOptions`
       - Add `readonly dashboardUrl: string;` to `AgentBusDaemon`
       - In `startDaemon()`, after `operatorService` is created and before `recoveryScan`:
         ```typescript
         let dashboardServer: DashboardServerHandle;
         try {
           dashboardServer = await createDashboardServer({
             operatorService,
             dashboardEmitter: dispatcher.dashboardEmitter,
             ...(options.dashboardPort !== undefined ? { port: options.dashboardPort } : {})
           });
         } catch (error) {
           await mcpServer.stop();
           database.close();
           throw error;
         }
         options.logger?.info({ event: "dashboard.started", dashboardUrl: dashboardServer.url });
         ```
       - In the `stop()` function, add `await dashboardServer.stop();` BEFORE `await mcpServer.stop();`
       - Add `dashboardUrl: dashboardServer.url,` to the returned daemon object

    2. In `src/cli/worker-command.ts`:
       - Add `"--dashboard-port"` to the `optionsWithValues` Set
       - Add help text: update `WORKER_HELP_TEXT` to include `[--dashboard-port N]`
       - Parse `--dashboard-port` using `parseIntegerAtLeast` with minimum 1:
         ```typescript
         const dashboardPort = parseIntegerAtLeast(
           readOptionValue(args, "--dashboard-port"),
           "--dashboard-port",
           1
         ) ?? undefined;
         ```
       - Pass to `startDaemonImpl`: `...(dashboardPort !== undefined ? { dashboardPort } : {})`
       - Add `dashboardUrl: daemon.dashboardUrl` to `writeWorkerStartedText` call (verify what `writeWorkerStartedText` accepts; may need to update `output.ts` as well)
       - If `writeWorkerStartedText` in `output.ts` doesn't accept `dashboardUrl`, add it as an optional field to the input type and print it in the startup banner

    3. Use `.js` extensions on relative imports. Use `import type` for type-only imports. Use conditional spread for optional fields (exactOptionalPropertyTypes pattern).
  </action>
  <verify>
    <automated>npm run build && npm test</automated>
  </verify>
  <done>
    - Daemon starts dashboard server alongside MCP server
    - Dashboard URL logged at startup with pino structured logging
    - Dashboard server stopped before MCP server during shutdown
    - `--dashboard-port` flag accepted by worker CLI
    - Dashboard URL printed in worker startup banner
    - Full test suite passes
  </done>
</task>

</tasks>

<verification>
```bash
npm run typecheck
npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js
npm test
```
</verification>

<success_criteria>
- SSE endpoint at GET /events sends snapshot on connect and relays typed events in real time
- Server shutdown cleanly aborts all SSE connections and resolves
- Dashboard server fully integrated into daemon lifecycle (start, stop, URL exposure)
- Worker CLI accepts --dashboard-port and prints dashboard URL
- approval.decided events emitted from approval-service
- Full test suite green
</success_criteria>

<output>
After completion, create `.gsd/phases/9/02-SUMMARY.md`
</output>
