---
status: complete
phase: 08-embedded-mcp-server
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md]
started: 2026-03-16T00:00:00Z
updated: 2026-03-16T13:30:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running daemon. Start the worker from scratch (e.g. `npm run daemon` or `agent-bus worker`). Daemon boots without errors, MCP server binds on a localhost port, and the worker enters its poll loop.
result: pass

### 2. Worker Banner Shows MCP URL
expected: On startup, the worker prints a banner line like `mcp: http://127.0.0.1:{port}/mcp`. The port should be a valid ephemeral port number (not 0).
result: pass

### 3. NDJSON Log Emits mcp.started Event
expected: When using structured/verbose logging, daemon emits a JSON log line with `"event":"mcp.started"` and the `mcpUrl` value shortly after start.
result: pass

### 4. --mcp-port Flag Controls Bound Port
expected: Starting the worker with `--mcp-port 19999` (or any free port) causes the MCP server to bind on that specific port. The banner shows `mcp: http://127.0.0.1:19999/mcp`.
result: pass

### 5. AGENT_BUS_MCP_URL Injected Into Agent Process
expected: When an agent is spawned, it receives `AGENT_BUS_MCP_URL` as an environment variable pointing to the running MCP server (e.g. `http://127.0.0.1:{port}/mcp`). Agents can read this to call back into the bus.
result: skipped
reason: Hard to verify manually without a test agent that prints env vars

### 6. publish_event Tool Accepts Valid Envelope
expected: An MCP client connecting to `AGENT_BUS_MCP_URL` and calling `publish_event` with a valid EventEnvelope (source, type, payload) succeeds — no `isError` in the response.
result: pass

### 7. publish_event Tool Rejects Invalid Envelope
expected: Calling `publish_event` with a malformed or missing-field envelope returns a response with `isError: true` and a descriptive error message. The daemon does not crash.
result: pass

### 8. MCP Server Stops Cleanly on Shutdown
expected: Sending SIGTERM (or SIGINT) to the daemon causes it to stop the MCP server before closing SQLite. No unhandled errors on exit. Process exits cleanly.
result: pass

## Summary

total: 8
passed: 7
issues: 0
pending: 0
skipped: 1
skipped: 0

## Gaps

[none yet]
