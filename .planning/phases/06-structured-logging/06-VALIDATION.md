---
phase: 6
slug: structured-logging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `node:assert/strict` |
| **Config file** | none — invoked via `node --experimental-sqlite --test dist/test/**/*.test.js` |
| **Quick run command** | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js dist/test/cli/worker-command.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js dist/test/cli/worker-command.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | LOG-01 | unit | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ (extend existing) | ⬜ pending |
| 6-01-02 | 01 | 1 | LOG-02 | unit | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ (extend existing) | ⬜ pending |
| 6-02-01 | 02 | 2 | LOG-03 | unit | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | ✅ (extend existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

No new test files need to be created; existing `adapter-worker.test.ts` and `worker-command.test.ts` are extended with new test cases.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator pipes stderr to `jq` and filters by deliveryId | LOG-03 | End-to-end operator workflow | Run `agent-bus worker 2>daemon.log`, then `cat daemon.log \| jq 'select(.deliveryId == "x")'` — verify filtered output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
