---
phase: 08-embedded-mcp-server
plan: 02
subsystem: daemon MCP lifecycle and worker wiring
tags: [mcp, worker, env, cli, phase-8]

requires:
  - 01-SUMMARY.md

provides:
  - Daemon-level MCP server start/stop wiring and exposed `mcpUrl`
  - `AGENT_BUS_MCP_URL` injection into adapter process environment
  - `--mcp-port` worker CLI flag and MCP startup banner output
  - NDJSON startup log event for MCP endpoint
  - Regression tests for registry env injection and worker flag/banner behavior

affects:
  - Runtime adapter invocation environment
  - Worker CLI startup UX and operational logs

tech-stack:
  added: []
  patterns:
    - Start MCP server before adapter worker initialization
    - Thread daemon `mcpUrl` through worker options into adapter command environment
    - Optional CLI port override with strict integer validation

key-files:
  created:
    - test/adapters/registry.test.ts
  modified:
    - src/daemon/index.ts
    - src/daemon/adapter-worker.ts
    - src/adapters/registry.ts
    - src/cli/worker-command.ts
    - src/cli/output.ts
    - test/cli/worker-command.test.ts

key-decisions:
  - "`mcpUrl` is always present on the running daemon object and is injected conditionally into adapter env"
  - "Worker banner always prints MCP URL; structured logs include `event: mcp.started`"
  - "`--mcp-port` remains optional; absent value keeps ephemeral localhost binding"

requirements-completed:
  - MCP-02
  - MCP-04

completed: 2026-03-16
---

# Phase 08 Plan 02 Summary

Integrated the MCP server created in Plan 01 into daemon and worker execution paths.

## Accomplishments

- `startDaemon()` now starts the MCP server after dispatcher creation and before worker construction
- `AgentBusDaemon` now exposes `mcpUrl`; shutdown path stops MCP server before SQLite close
- Adapter worker now accepts `mcpUrl` and forwards it into `buildAdapterCommand`
- Registry now supports optional `mcpUrl` and injects `AGENT_BUS_MCP_URL` in base env
- Worker CLI now supports `--mcp-port` and forwards value into `startDaemon`
- Worker startup banner now includes `mcp: {url}`
- Worker NDJSON logs now emit `event: "mcp.started"` with `mcpUrl`
- Added and extended tests for registry env injection, `--mcp-port` parsing, banner output, and NDJSON MCP log event

## Verification

```text
npm run build && node --experimental-sqlite --test dist/test/adapters/registry.test.js     ✓
npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js    ✓
npm test                                                                                    ✓ (116/116)
```
