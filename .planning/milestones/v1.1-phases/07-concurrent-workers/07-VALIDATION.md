---
phase: 7
slug: concurrent-workers
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` (no external test runner) |
| **Config file** | None — tests are run directly |
| **Quick run command** | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | WORKER-01 | unit | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Yes | ✅ green |
| 07-01-02 | 01 | 1 | WORKER-02 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Yes | ✅ green |
| 07-02-01 | 02 | 1 | WORKER-01 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Yes | ✅ green |
| 07-02-02 | 02 | 1 | WORKER-03 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Yes | ✅ green |
| 07-02-03 | 02 | 1 | WORKER-03 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Yes | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] New test cases in `test/cli/worker-command.test.ts` — concurrency, flag validation, default concurrency, graceful drain, drain timeout, and lease conflict coverage added

*Existing test infrastructure is sufficient — no new framework or config needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Verbose output shows `[agentId]` prefix with concurrent agents | WORKER-01 | Visual formatting check | Run `agent-bus worker --concurrency 2 --verbose` with 2+ pending deliveries, verify each line has agent-specific prefix |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-15 — `node --experimental-sqlite --test dist/test/cli/worker-command.test.js` and `npm test` both green
