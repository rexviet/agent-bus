---
phase: 8
slug: embedded-mcp-server
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-16
audited: 2026-03-16
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` (Node 22.12+) |
| **Config file** | none — tests run via `npm test` |
| **Quick run command** | `npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Test Name | File | Status |
|--------|----------|-----------|-----------|------|--------|
| MCP-01 | Daemon starts MCP HTTP server on localhost | unit | `createMcpServer starts on localhost and exposes /mcp URL` | `test/daemon/mcp-server.test.ts` | ✅ green |
| MCP-01 | Server fails hard if port conflict on startup | unit | `createMcpServer rejects when requested port is already in use` | `test/daemon/mcp-server.test.ts` | ✅ green |
| MCP-02 | `AGENT_BUS_MCP_URL` present in agent env vars | unit | `buildAdapterCommand includes AGENT_BUS_MCP_URL when mcpUrl is provided` | `test/adapters/registry.test.ts` | ✅ green |
| MCP-02 | Worker startup banner includes `mcp:` line | unit | `worker forwards --mcp-port and prints startup mcp URL` | `test/cli/worker-command.test.ts` | ✅ green |
| MCP-03 | `publish_event` calls callback on valid envelope | unit | `publish_event calls callback and returns ok on valid envelope` | `test/daemon/mcp-server.test.ts` | ✅ green |
| MCP-03 | `publish_event` returns error on invalid envelope | unit | `publish_event returns isError on invalid envelope` | `test/daemon/mcp-server.test.ts` | ✅ green |
| MCP-04 | `events` array still works alongside MCP path | unit | existing adapter-worker tests (10/10 green) | `test/daemon/adapter-worker.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/daemon/mcp-server.test.ts` — 9/9 tests covering MCP-01, MCP-03 (startup, stop, publish_event valid/invalid/error, port binding, port conflict, sequential requests)
- [x] `test/adapters/registry.test.ts` — 3/3 tests covering MCP-02 (AGENT_BUS_MCP_URL injection, omission, base vars)
- [x] `test/cli/worker-command.test.ts` — covers MCP-02 banner (--mcp-port + startup output)

*All Wave 0 files created and green. No new framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ 2026-03-16

---

## Validation Audit 2026-03-16

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 7 (all covered by existing tests) |
| Escalated | 0 |

All Wave 0 test files were created during phase execution and are green:
- `mcp-server.test.ts`: 9/9
- `registry.test.ts`: 3/3
- `worker-command.test.ts`: 12/12 (MCP banner test included)
- `adapter-worker.test.ts`: 10/10 (backward compat)
