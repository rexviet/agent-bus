# Phase 9: Web Dashboard - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Local HTTP dashboard served by the daemon for real-time visibility into runs, deliveries, approvals, and failures. Read-only — approve/reject actions stay in CLI. No authentication (localhost-only). Plain HTML + vanilla JS, no build pipeline.

</domain>

<decisions>
## Implementation Decisions

### Page structure
- Single scrollable page with three sections, no tabs or sidebar navigation
- Attention-first ordering: Pending Approvals → Failures → Runs
- Compact run rows: truncated run ID, status badge, delivery count (completed/total), relative timestamp — one line per run
- Empty sections auto-hidden by default; "Show all sections" toggle reveals them

### Run detail view
- Clicking a run row expands it inline to show full details (no page navigation)
- Expanded view shows: Deliveries with state, Events list, Error messages for failed deliveries, Approval status
- Subsections (Deliveries/Events/Approvals) are all visible when expanded — not individually collapsible
- Clicking a failure row in the Failures section scrolls to the parent run and expands it with the failed delivery highlighted

### Visual styling
- Dark terminal aesthetic: dark background (#1a1a2e / #16213e), monospace font, muted text (#e0e0e0)
- Cards/rows use slightly lighter background (#1e293b) with subtle dark borders
- Delivery states shown as colored dots + text label:
  - completed → green (#4ade80)
  - in_progress/leased → blue (#60a5fa)
  - attention/retry → amber (#fbbf24)
  - dead_letter → red (#f87171)
  - ready → gray (#9ca3af)
  - pending_approval → gray outline
  - cancelled → dim
- Minimal header: "Agent Bus" title + SSE connection status indicator (green dot = live)
- Timestamps displayed as relative ("3m ago", "1h ago") — updated periodically via JS

### SSE update behavior
- Granular SSE event types pushed by server:
  - `delivery.state_changed` — { deliveryId, runId, agentId, oldState, newState }
  - `approval.created` — { approvalId, eventId, runId, topic }
  - `approval.decided` — { approvalId, status, decidedBy }
  - `event.published` — { eventId, runId, topic }
- Changed rows get a brief highlight flash animation (amber glow, 1-2s) then settle
- New runs auto-insert at top of the Runs list
- Auto-reconnect on SSE disconnect with exponential backoff (3-5s retry)
- Connection indicator reflects state: [● live] → [○ disconnected] → [◦ reconnecting...]
- On reconnect, full page data refresh to catch up on missed events

### Claude's Discretion
- Exact CSS animations and transitions
- Hono route structure and middleware
- How to add EventEmitter hooks to dispatcher for SSE (STATE.md notes this needs investigation)
- HTML template structure and vanilla JS organization
- SSE keepalive interval
- How many runs to show by default (pagination/limit)

</decisions>

<specifics>
## Specific Ideas

- Dark terminal aesthetic — should feel like a monitoring tool, not a SaaS app
- Attention-first layout — things needing action float to top, informational content below
- Failure rows are cross-references into the Runs section — clicking jumps and expands the parent run

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `operator-service.ts`: Already exposes `listRunSummaries()`, `getRunDetail()`, `listPendingApprovalViews()`, `listFailureDeliveries()` — all query methods the dashboard API needs
- `output.ts`: CLI text formatters for all data types — can inform JSON API response shapes
- `mcp-server.ts`: Pattern for starting an HTTP server alongside the daemon on localhost with ephemeral port binding

### Established Patterns
- Raw `node:http` used for MCP server — dashboard will use Hono + `@hono/node-server` instead (new pattern)
- Daemon `stop()` already orchestrates shutdown of MCP server — dashboard server needs similar integration
- pino structured logging with correlation fields — dashboard server should log with same pattern

### Integration Points
- `startDaemon()` in `daemon/index.ts` — needs to start Hono server alongside MCP server, expose dashboard URL
- `dispatcher.ts` — currently records notifications but has no EventEmitter; SSE needs event emission hooks added
- `StartDaemonOptions` — needs new option for dashboard port (similar to `mcpPort`)
- `AgentBusDaemon` — needs to expose dashboard URL (similar to `mcpUrl`)
- `daemon.stop()` — needs to shut down dashboard server and close all SSE connections cleanly (DASH-08 success criterion)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-web-dashboard*
*Context gathered: 2026-03-17*
