# STATE.md

> **Current Phase**: 2 - Orchestration Core (completed)
> **Current Focus**: Paused after merging Phase 2 into `main`
> **Last Updated**: 2026-03-09

## Current Position
- **Phase**: 2 (completed)
- **Task**: Between tasks
- **Status**: Paused at 2026-03-09 23:57 +07

## Active Work
- Phase 1.1 completed
- Phase 1.2 completed
- Phase 1.3 completed
- Phase 1.4 completed
- Phase 2.1 completed
- Phase 2.2 completed
- Phase 2.3 completed
- Phase 2.4 completed

## Last Session Summary
Phase 2 was finalized and merged through the PR chain into `main`. Replay invariants were tightened before merge: rejected events can no longer be replayed into ready work, replay resets delivery execution state, and regression coverage now locks approval and retry semantics. Local `main` was synced to `origin/main`.

## In-Progress Work
No product code is currently in progress.
- Files modified: `.gsd/STATE.md`, `.gsd/JOURNAL.md`
- Tests status: not run in this pause step; latest verified state on the merged Phase 2 work was `npm run typecheck` and `npm test` passing on Node `22.12.0`

## Blockers
No active implementation blocker.

## Context Dump
Critical context that would be lost:

### Decisions Made
- Replay must respect approval state: replay is allowed only for events with `approvalStatus` of `approved` or `not_required`, because replaying rejected work bypasses the product's human-gate contract.
- Replay must reset execution state: `attemptCount`, lease fields, and terminal timestamps are cleared on replay so replayed work starts with a fresh retry budget and coherent audit metadata.
- Node runtime baseline remains `22.12.0+`: local failures on older environments were caused by the repo's use of `node --experimental-sqlite`.

### Approaches Tried
- Reviewed Phase 2 diff against spec and plans: found approval bypass and replay-budget bugs in replay semantics.
- Reproduced both replay bugs with local one-off Node runs: confirmed the issues were real, not just theoretical.
- Added daemon-level and store-level regression tests: all replay and approval invariants now pass in the full suite.

### Current Hypothesis
The next highest-value step is Phase 3 planning around runtime adapters, because the orchestration core is now stable enough to wire real agent runtimes onto it.

### Files of Interest
- `src/daemon/replay-service.ts`: gate replay by event approval state before any delivery is re-queued.
- `src/storage/delivery-store.ts`: replay eligibility and replay state reset logic live here.
- `test/daemon/orchestration-core.test.ts`: covers approval-path replay invariants.
- `test/daemon/retry-dlq.test.ts`: covers retry, dead-letter, and replay budget behavior.
- `.github/workflows/ci.yml`: CI was added on the Phase 2 planning branch and is now on `main`.

## Next Steps
1. `/plan 3`
2. Scope Phase 3 around runtime adapter contracts for Codex, Antigravity, and Open Code
3. Decide whether to pin Node with `.nvmrc` or Volta to reduce local environment drift

## Notes
- Project initialized through `/new-project`.
- Phase 1 planning assumes TypeScript on Node 22, a root `agent-bus.yaml` manifest, `workspace/` for artifacts, and `.agent-bus/` for internal state.
- Plan 1.1 completed with commits `23ca023` and `a49257f`.
- Plan 1.2 completed with commits `3240c3a`, `7935dce`, and `f4a29f0`.
- Plan 1.3 completed with commits `8368569`, `1a926c0`, and `b08ea22`.
- Plan 1.4 completed with commits `e39b675`, `e6e3d31`, and `300b997`.
- Phase 2 execution completed with commits `8aefba6`, `7babd78`, `1e87746`, `31a930b`, `5cb0d1d`, `a0293c4`, `95c8076`, `a65f3f1`, and `48c3779`.
- Replay invariant fixes landed in commit `10a87f7` and were merged before PR `#1` was merged into PR `#3`.
