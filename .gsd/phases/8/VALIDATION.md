---
phase: 8
slug: embedded-mcp-server
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---
<!-- AUTO-GENERATED from .planning/phases/08-embedded-mcp-server/08-VALIDATION.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 07afc03086c375a684144b7194e8e2e1d18df29dabe0090a9ee1dc8f02fc1720. Edit the source file, not this projection. -->


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

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| MCP-01 | Daemon starts MCP HTTP server on localhost | unit | `node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` | ❌ W0 | ⬜ pending |
| MCP-01 | Server fails hard if port conflict on startup | unit | same file | ❌ W0 | ⬜ pending |
| MCP-02 | `AGENT_BUS_MCP_URL` present in agent env vars | unit | `node --experimental-sqlite --test dist/test/adapters/registry.test.js` | ❌ W0 | ⬜ pending |
| MCP-02 | Worker startup banner includes `mcp:` line | unit | `node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | ✅ (extend) | ⬜ pending |
| MCP-03 | `publish_event` tool stores event in event store | unit | `node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` | ❌ W0 | ⬜ pending |
| MCP-03 | `publish_event` tool returns error on invalid envelope | unit | same file | ❌ W0 | ⬜ pending |
| MCP-04 | `events` array still works alongside MCP path | unit | existing `adapter-worker.test.js` (verify unchanged) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/daemon/mcp-server.test.ts` — stubs for MCP-01, MCP-03
- [ ] `test/adapters/registry.test.ts` — extend with MCP-02 (AGENT_BUS_MCP_URL env var)

*Existing `test/cli/worker-command.test.ts` covers MCP-02 banner — extend in-place. No new framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
