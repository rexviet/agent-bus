# STATE.md

> **Current Phase**: 3 - Runtime Adapters (planned)
> **Current Focus**: Phase 3 plans are ready for execution
> **Last Updated**: 2026-03-10

## Current Position
- **Phase**: 3
- **Task**: Planning complete
- **Status**: Ready for execution (2026-03-10 11:04 +07)

## Active Work
- Phase 1.1 completed
- Phase 1.2 completed
- Phase 1.3 completed
- Phase 1.4 completed
- Phase 2.1 completed
- Phase 2.2 completed
- Phase 2.3 completed
- Phase 2.4 completed
- Phase 3 research completed
- Phase 3.1 planned
- Phase 3.2 planned
- Phase 3.3 planned
- Phase 3.4 planned

## Last Session Summary
Phase 3 planning is now complete. Runtime adapter research confirmed that the safest path is a file-backed daemon-to-adapter contract, with vendor-specific builders for Codex, Open Code, and Antigravity layered on top of the Phase 2 orchestration services.

## In-Progress Work
No product code is currently in progress.
- Files modified: `.gsd/STATE.md`, `.gsd/JOURNAL.md`, `.gsd/phases/3/RESEARCH.md`, `.gsd/phases/3/01-PLAN.md`, `.gsd/phases/3/02-PLAN.md`, `.gsd/phases/3/03-PLAN.md`, `.gsd/phases/3/04-PLAN.md`
- Tests status: no npm commands run during planning; plan files passed manual checker review for requirement coverage, dependencies, verify commands, and context references

## Blockers
No active implementation blocker.

## Context Dump
Critical context that would be lost:

### Decisions Made
- Replay must respect approval state: replay is allowed only for events with `approvalStatus` of `approved` or `not_required`, because replaying rejected work bypasses the product's human-gate contract.
- Replay must reset execution state: `attemptCount`, lease fields, and terminal timestamps are cleared on replay so replayed work starts with a fresh retry budget and coherent audit metadata.
- Node runtime baseline remains `22.12.0+`: local failures on older environments were caused by the repo's use of `node --experimental-sqlite`.
- Phase 3 should use a file-backed adapter contract: the daemon writes a work package and reads a result envelope, so runtime workers never touch SQLite directly.
- Runtime invocation must be vendor-specific behind a shared contract: `codex exec`, `opencode run`, and `antigravity chat --mode agent` should be isolated in adapter modules instead of hardcoded in daemon logic.
- The Open Code binary on this machine is `opencode`, so the adapter layer must absorb binary-name drift while preserving stable manifest runtime identities.

### Approaches Tried
- Reviewed Phase 2 diff against spec and plans: found approval bypass and replay-budget bugs in replay semantics.
- Reproduced both replay bugs with local one-off Node runs: confirmed the issues were real, not just theoretical.
- Added daemon-level and store-level regression tests: all replay and approval invariants now pass in the full suite.
- Inspected the installed `codex`, `opencode`, and `antigravity` CLIs to confirm their current non-interactive or editor-driven command surfaces.
- Cross-checked runtime guidance against official Codex, Open Code, and Antigravity documentation to avoid planning around stale placeholder commands.
- Decomposed Phase 3 into four sequential plans so contract work, daemon execution, vendor adapters, and end-to-end verification stay within the repo's planning context budget.

### Current Hypothesis
The next highest-value step is executing Plan 3.1 so the adapter contract is frozen before any daemon worker or vendor-specific runtime code lands.

### Files of Interest
- `.gsd/phases/3/RESEARCH.md`: documents the adapter contract decision and the observed runtime CLI surfaces.
- `.gsd/phases/3/01-PLAN.md`: defines the shared adapter contract and registry work.
- `.gsd/phases/3/02-PLAN.md`: wires daemon-owned adapter execution and fixture-based tests.
- `.gsd/phases/3/03-PLAN.md`: implements Codex and Open Code adapters.
- `.gsd/phases/3/04-PLAN.md`: adds Antigravity, updates manifests, and finishes end-to-end coverage.
- `src/daemon/replay-service.ts`: gate replay by event approval state before any delivery is re-queued.
- `src/storage/delivery-store.ts`: replay eligibility and replay state reset logic live here.
- `src/daemon/index.ts`: the Phase 2 service boundary that Phase 3 worker execution should extend.
- `src/config/manifest-schema.ts`: current manifest fields already expose `runtime`, `command`, `workingDirectory`, and `environment`.

## Next Steps
1. `/execute 3`
2. Start with Plan 3.1 to define the shared adapter contract and runtime registry
3. Keep Node `22.12.0` pinned during execution and decide later whether to codify that with `.nvmrc` or Volta

## Notes
- Project initialized through `/new-project`.
- Phase 1 planning assumes TypeScript on Node 22, a root `agent-bus.yaml` manifest, `workspace/` for artifacts, and `.agent-bus/` for internal state.
- Plan 1.1 completed with commits `23ca023` and `a49257f`.
- Plan 1.2 completed with commits `3240c3a`, `7935dce`, and `f4a29f0`.
- Plan 1.3 completed with commits `8368569`, `1a926c0`, and `b08ea22`.
- Plan 1.4 completed with commits `e39b675`, `e6e3d31`, and `300b997`.
- Phase 2 execution completed with commits `8aefba6`, `7babd78`, `1e87746`, `31a930b`, `5cb0d1d`, `a0293c4`, `95c8076`, `a65f3f1`, and `48c3779`.
- Replay invariant fixes landed in commit `10a87f7` and were merged before PR `#1` was merged into PR `#3`.
