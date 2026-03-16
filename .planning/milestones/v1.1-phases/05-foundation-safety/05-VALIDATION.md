---
phase: 5
slug: foundation-safety
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-14
audited: 2026-03-16
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (node:test) |
| **Config file** | none — invoked via `npm test` |
| **Quick run command** | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds (process-runner tests take ~15s due to SIGKILL grace periods) |

---

## Sampling Rate

- **After every task commit:** Run quick command for the directly affected test file
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | TIMEOUT-01 | unit | `node --experimental-sqlite --test dist/test/config/manifest.test.js` | ✅ `test/config/manifest.test.ts` | ✅ green |
| 5-02-01 | 02 | 1 | TIMEOUT-02, TIMEOUT-03 | integration | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ✅ `test/adapters/process-runner-monitor.test.ts` | ✅ green |
| 5-02-02 | 02 | 1 | TIMEOUT-02, TIMEOUT-03 | integration (fixture) | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ✅ `test/fixtures/adapters/timeout-group-fixture.mjs` | ✅ green |
| 5-03-01 | 03 | 2 | TIMEOUT-04 | integration | `node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ `test/daemon/adapter-worker.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/fixtures/adapters/timeout-group-fixture.mjs` — spawns a grandchild process that ignores SIGTERM; verifies process group kill reaches the grandchild. Covers TIMEOUT-02 and TIMEOUT-03. **Created in Plan 02 (commit a05bb91).**

*(All other test files extend existing test files with new cases.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Process group actually killed in real shell-wrapped agent scenario | TIMEOUT-02 | Requires real agent command wrapping | Run daemon with a `bash -c "sleep 9999"` agent, set `timeout: 1`, verify grandchild (sleep) is also killed |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ Nyquist-compliant (2026-03-16)

---

## Validation Audit 2026-03-16

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Tests run | 30 |
| Tests passing | 30 |

All requirements COVERED. Status updated from `draft/pending` to `complete/green`.
Wave 0 fixture (`timeout-group-fixture.mjs`) confirmed present and exercised by process-runner-monitor tests 8-10.
