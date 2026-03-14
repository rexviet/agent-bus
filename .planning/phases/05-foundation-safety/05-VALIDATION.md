---
phase: 5
slug: foundation-safety
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
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
| **Estimated runtime** | ~15 seconds |

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
| 5-01-01 | 01 | 1 | TIMEOUT-01 | unit | `node --experimental-sqlite --test dist/test/config/manifest.test.js` | ✅ extend | ⬜ pending |
| 5-02-01 | 02 | 1 | TIMEOUT-02, TIMEOUT-03 | integration | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ✅ extend | ⬜ pending |
| 5-02-02 | 02 | 1 | TIMEOUT-02, TIMEOUT-03 | integration (fixture) | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 2 | TIMEOUT-04 | integration | `node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/fixtures/adapters/timeout-group-fixture.mjs` — spawns a grandchild process that ignores SIGTERM; verifies process group kill reaches the grandchild. Covers TIMEOUT-02 and TIMEOUT-03.

*(All other test files exist; new test cases will be added to existing files.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Process group actually killed in real shell-wrapped agent scenario | TIMEOUT-02 | Requires real agent command wrapping | Run daemon with a `bash -c "sleep 9999"` agent, set `timeout: 1`, verify grandchild (sleep) is also killed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
