---
phase: 7
slug: concurrent-workers
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 07-01-01 | 01 | 1 | WORKER-01 | unit | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Partial | ⬜ pending |
| 07-01-02 | 01 | 1 | WORKER-02 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Partial | ⬜ pending |
| 07-02-01 | 02 | 1 | WORKER-01 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | No | ⬜ pending |
| 07-02-02 | 02 | 1 | WORKER-03 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | No | ⬜ pending |
| 07-02-03 | 02 | 1 | WORKER-03 | integration | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | No | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `test/cli/worker-command.test.ts` — stubs for WORKER-01 (concurrent execution, flag validation), WORKER-02 (default concurrency), WORKER-03 (drain on shutdown, drain timeout)

*Existing test infrastructure is sufficient — no new framework or config needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Verbose output shows `[agentId]` prefix with concurrent agents | WORKER-01 | Visual formatting check | Run `agent-bus worker --concurrency 2 --verbose` with 2+ pending deliveries, verify each line has agent-specific prefix |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
