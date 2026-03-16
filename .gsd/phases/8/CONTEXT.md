<!-- AUTO-GENERATED from .planning/phases/08-embedded-mcp-server/08-CONTEXT.md by scripts/sync-planning-to-gsd.mjs. source-sha256: af1c6fcf8979f7f21d3d6e42bfbcc2836b88cf301f7e1489ed3d6d9ffe1b57fb. Edit the source file, not this projection. -->

# Phase 8: Embedded MCP Server - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Embed an MCP HTTP server in the daemon so agents can publish follow-up events directly during execution by calling the `publish_event` MCP tool. The agent builds a full EventEnvelope and calls `publish_event` via MCP — the server validates and persists it using the existing `publishEvent()` function. Creating additional MCP tools (get_delivery, list_artifacts) is out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Port allocation
- Optional `--mcp-port` CLI flag to set a specific port; if omitted, falls back to ephemeral `server.listen(0)`
- Bind to `127.0.0.1` only — localhost, no network exposure
- MCP URL displayed in worker startup banner: "Worker started: worker-1234, concurrency: 4, mcp: http://127.0.0.1:54321/mcp"
- Also logged via NDJSON at info level

### MCP server design (stateless)
- Agent builds the full EventEnvelope (eventId, runId, correlationId, causationId, dedupeKey, producer, payload, etc.) — work package provides all necessary context
- MCP `publish_event` tool accepts a full EventEnvelope, validates it with existing Zod schemas, then calls `publishEvent()` (persist + fan-out + dispatch — same as CLI publish)
- Server is completely stateless — no delivery context mapping, no session management, no tracking of which agent is calling
- Response is simple success/error — no eventId or delivery count returned

### Identity file integration (MCP-04)
- Identity files (e.g., claude-code .identity.md) call `publish_event` via MCP directly using `AGENT_BUS_MCP_URL` — no adapter-level bridging
- No special adapter handling — identity file agents use MCP the same way as any other agent
- Result envelope `events` array remains as an alternative path (not deprecated in v1.1)

### SDK choice
- Use `@modelcontextprotocol/sdk` (McpServer + StreamableHTTPServerTransport) — spec-compliant, justified as 4th production dependency
- Import paths (`StreamableHTTPServerTransport`, `McpServer`) must be verified against installed SDK version during research-phase (flagged in STATE.md)
- Derive MCP tool input schema from existing Zod EventEnvelope types to prevent schema drift

### Server lifecycle
- MCP server starts automatically with daemon (always-on, no opt-in flag) — matches MCP-01 "accessible without any additional setup"
- Single server shared across all concurrent worker slots (stateless, so no routing needed)
- Startup order: load manifest → open SQLite → start MCP server → enter poll loop
- Shutdown order: stop claiming → drain in-flight deliveries → close MCP server → close SQLite
- If MCP server fails to start (port conflict, etc.), daemon refuses to start — fail hard, no silent degradation
- `AGENT_BUS_MCP_URL` env var injected into every agent process (alongside existing `AGENT_BUS_*` vars)

### Claude's Discretion
- Exact file placement for MCP server module (likely `src/daemon/mcp-server.ts`)
- How MCP server instance is threaded through daemon startup options
- StreamableHTTPServerTransport configuration details
- Test strategy and fixture design

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `publishEvent()` (`publish-event.ts:206-227`): Full persist + fan-out + dispatch — MCP handler calls this directly
- `buildFollowUpEventEnvelope()` (`publish-event.ts:85-109`): Available for agents that want a helper, but agents can also build envelopes manually
- `EventEnvelope` Zod schema (`contract.ts`): Reuse for MCP tool input validation
- `buildBaseEnvironment()` (`registry.ts:111-123`): Where `AGENT_BUS_MCP_URL` needs to be added to agent env vars

### Established Patterns
- CLI flags follow `--kebab-case` pattern — `--mcp-port` follows this
- `parseIntegerAtLeast()` (`worker-command.ts:61-77`): Reusable for parsing `--mcp-port`
- `writeWorkerStartedText` (`output.ts`): Extend with MCP URL field
- DI via options objects — MCP server instance passed through daemon startup options

### Integration Points
- `src/cli/worker-command.ts` — Parse `--mcp-port`, start MCP server, thread to daemon, add to startup banner
- `src/adapters/registry.ts:buildBaseEnvironment()` — Add `AGENT_BUS_MCP_URL` env var
- `src/daemon/publish-event.ts` — MCP handler calls existing `publishEvent()`
- `src/cli/output.ts` — Extend `writeWorkerStartedText` with MCP URL
- `package.json` — Add `@modelcontextprotocol/sdk` dependency

</code_context>

<specifics>
## Specific Ideas

- MCP server is a thin wrapper: validate envelope → call `publishEvent()` → return ok/error
- Agent already has all context from work package to build a complete EventEnvelope — no daemon-side context injection needed
- The `--mcp-port` flag exists for operators with firewall/proxy constraints; most users will never set it

</specifics>

<deferred>
## Deferred Ideas

- `get_delivery` MCP tool — deferred to v2 (MCP-05)
- `list_artifacts` MCP tool — deferred to v2 (MCP-06)
- `events` array deprecation in result envelope — keep backward-compat in v1.1, deprecate in v1.2
- MCP authentication — not needed for localhost-only v1.1

</deferred>

---

*Phase: 08-embedded-mcp-server*
*Context gathered: 2026-03-16*
