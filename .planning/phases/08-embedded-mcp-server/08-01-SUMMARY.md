---
phase: 08-embedded-mcp-server
plan: 01
subsystem: embedded MCP server
tags: [mcp, daemon, phase-8]

requires:
  - null

provides:
  - `createMcpServer()` HTTP MCP server factory with `publish_event` tool
  - MCP server lifecycle (`url`, `stop()`) with localhost binding
  - Validation + error handling for `publish_event`
  - Dedicated daemon MCP tests covering startup/shutdown and tool behavior

affects:
  - Phase 8 plan 02 daemon lifecycle wiring

tech-stack:
  added:
    - "@modelcontextprotocol/sdk@^1.27.1"
  patterns:
    - Per-request `StreamableHTTPServerTransport` instance
    - MCP tool input validation using `EventEnvelopeSchema.shape`

key-files:
  created:
    - src/daemon/mcp-server.ts
    - test/daemon/mcp-server.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Tool registration happens before request handling; each POST uses a fresh transport instance"
  - "Server binds to 127.0.0.1 with default ephemeral port, and supports explicit `port` override"
  - "Tool handler returns structured `isError: true` responses for invalid envelopes and callback failures"

requirements-completed:
  - MCP-01
  - MCP-03

completed: 2026-03-16
---

# Phase 08 Plan 01 Summary

Implemented the standalone MCP HTTP server module and test coverage required for Phase 8 core behavior.

## Accomplishments

- Installed `@modelcontextprotocol/sdk`
- Added `src/daemon/mcp-server.ts` with:
  - `createMcpServer(options)` factory
  - `publish_event` tool registration
  - Event envelope validation using `EventEnvelopeSchema`
  - Per-request transport lifecycle over HTTP `/mcp`
- Added `test/daemon/mcp-server.test.ts` with coverage for:
  - Startup URL format and localhost binding
  - Clean shutdown behavior
  - Valid `publish_event` callback path
  - Invalid envelope error path
  - Callback exception error path
  - Explicit port binding
  - Port conflict failure
  - Multiple sequential requests

## Verification

```text
npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js  ✓ (8/8)
```
