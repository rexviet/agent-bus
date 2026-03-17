---
phase: 9
slug: web-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---
<!-- AUTO-GENERATED from .planning/phases/09-web-dashboard/09-VALIDATION.md by scripts/sync-planning-to-gsd.mjs. source-sha256: bc7e8e0bc56d33788ccddbcef7fccc07490a2f88f1db9c259485e180e86f2914. Edit the source file, not this projection. -->


# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` |
| **Config file** | None — tests run via `node --experimental-sqlite --test` |
| **Quick run command** | `npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | DASH-01 | unit | `node --experimental-sqlite --test dist/test/daemon/dashboard-server.test.js` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | DASH-01 | unit | same file | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | DASH-02 | unit | same file | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 1 | DASH-03 | unit | same file | ❌ W0 | ⬜ pending |
| 09-04-01 | 04 | 1 | DASH-04 | unit | same file | ❌ W0 | ⬜ pending |
| 09-05-01 | 05 | 1 | DASH-05 | unit | same file | ❌ W0 | ⬜ pending |
| 09-06-01 | 06 | 1 | DASH-06 | unit | same file | ❌ W0 | ⬜ pending |
| 09-07-01 | 07 | 1 | DASH-07 | manual | — | — | ⬜ pending |
| 09-08-01 | 08 | 1 | DASH-08 | unit | same file | ❌ W0 | ⬜ pending |
| 09-08-02 | 08 | 1 | DASH-08 | unit | same file (shutdown) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/daemon/dashboard-server.test.ts` — stubs for DASH-01 through DASH-08 (all unit-testable behaviors)

*Existing infrastructure covers test framework and helpers — only the new test file is needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard UI updates live via SSE without manual refresh | DASH-07 | Browser interaction required — SSE client behavior + DOM updates are visual | 1. Start daemon with dashboard 2. Open dashboard URL 3. Publish an event via CLI 4. Verify delivery status updates appear without refreshing |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
