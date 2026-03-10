# STATE.md

> **Current Phase**: 4 - Operator Workflow
> **Current Focus**: Phase 4 planning is complete; execution should start with Plan 4.1
> **Last Updated**: 2026-03-10

## Current Position
- **Phase**: 4 - Operator Workflow
- **Task**: Planning complete
- **Status**: Ready for execution at 2026-03-10 14:48 +07

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
- Phase 3.1 completed
- Phase 3.2 completed
- Phase 3.3 completed
- Phase 3.4 completed
- Phase 3 verification completed
- Phase 3 merged to `main`
- Phase 4 research completed
- Phase 4.1 planned
- Phase 4.2 planned
- Phase 4.3 planned
- Phase 4.4 planned

## Last Session Summary
Phase 4 is now decomposed into four execution plans on branch `feature/phase-4-planning`. The phase will start by building daemon-owned operator read models, then layer read-only CLI commands, mutating operator commands plus a publish bootstrap, and finally a deterministic end-to-end operator demo.

## In-Progress Work
No product code is currently in progress.
- Branch: `feature/phase-4-planning`
- Files modified: `.gsd/phases/4/*`, `.gsd/STATE.md`, `.gsd/JOURNAL.md`
- Tests status: Planning-only turn; no npm verification commands were run after Phase 3 merge

## Blockers
No active implementation blocker.

## Context Dump
Critical context that would be lost:

### Decisions Made
- Replay must respect approval state: replay is allowed only for events with `approvalStatus` of `approved` or `not_required`, because replaying rejected work bypasses the product's human-gate contract.
- Replay must reset execution state: `attemptCount`, lease fields, and terminal timestamps are cleared on replay so replayed work starts with a fresh retry budget and coherent audit metadata.
- Node runtime baseline remains `22.12.0+`: local failures on older environments were caused by the repo's use of `node --experimental-sqlite`.
- Phase 3 uses a file-backed adapter contract: the daemon writes a work package and reads a result envelope, so runtime workers never touch SQLite directly.
- Fatal adapter failures dead-letter immediately, while retryable failures reschedule with explicit retry delays; clean exits without a result envelope are treated as process-level contract failures.
- Runtime invocation is vendor-specific behind a shared contract: `codex exec`, `opencode run`, and `antigravity chat --mode agent` are isolated in adapter modules instead of hardcoded in daemon logic.
- The shipped manifests now use real runtime command shapes instead of stale placeholders, so repository examples match the current adapter layer.
- The Open Code binary on this machine is `opencode`, so the adapter layer must absorb binary-name drift while preserving stable manifest runtime identities.
- The stale-lease and emitted-event atomicity bugs found in review were fixed before merge: follow-up events now persist atomically with parent acknowledgement, and lease expiry no longer crashes the worker path.
- Phase 4 will add a daemon-owned operator service instead of letting CLI commands query SQLite directly.
- Phase 4 run visibility should derive summary state from persisted events and deliveries instead of relying on the currently static `runs.status` field.
- Phase 4 operator commands should support both concise text output and `--json`, with a thin `publish --envelope` bootstrap instead of a flag-heavy event builder.
- Phase 4 demo verification should use deterministic fixture agents and generic manifest commands, not authenticated external runtimes.

### Approaches Tried
- Froze the shared adapter contract first with schema and path-safety tests before wiring any runtime execution.
- Added a daemon-owned process runner and worker loop with deterministic fixture adapters covering success, retryable failure, fatal failure, and emitted-event fan-out.
- Implemented vendor-specific builders for `codex`, `opencode`, and `antigravity` while preserving a generic manifest-command fallback for custom wrappers and fixtures.
- Updated the shipped manifests to match real runtime command shapes and validated them through the compiled CLI.
- Proved end-to-end artifact handoff across codex, open-code, and antigravity identities in a temporary local repository and kept smoke checks availability-aware for external CLIs.
- Re-reviewed the Phase 3 branch after fixing the lease-expiry race and publish-before-ack bug; no remaining blocking findings were found before PR `#6` was merged.

### Current Hypothesis
The next highest-value step is `/execute 4`, starting with Plan 4.1 so the operator read models and daemon inspection boundary exist before any CLI command surface is added.

### Files of Interest
- `.gsd/phases/4/RESEARCH.md`: Phase 4 design decisions and operator-surface constraints.
- `.gsd/phases/4/01-PLAN.md`: read-model and daemon operator-service work.
- `.gsd/phases/4/02-PLAN.md`: read-only operator CLI commands.
- `.gsd/phases/4/03-PLAN.md`: approval, rejection, replay, and publish bootstrap CLI commands.
- `.gsd/phases/4/04-PLAN.md`: deterministic end-to-end operator demo workflow.
- `.gsd/phases/3/VERIFICATION.md`: Phase 3 requirement verification and closing evidence.
- `.gsd/phases/3/RESEARCH.md`: Phase 3 runtime constraints and command-surface decisions that still shape Phase 4.
- `src/adapters/contract.ts`: shared file-backed work package and result envelope contract.
- `src/adapters/process-runner.ts`: local command execution and result-envelope loading.
- `src/daemon/adapter-worker.ts`: daemon-owned claim -> execute -> republish -> ack/fail loop.
- `src/adapters/registry.ts`: runtime registry plus vendor-builder dispatch and generic fallback.
- `src/adapters/vendors/codex.ts`, `src/adapters/vendors/open-code.ts`, `src/adapters/vendors/antigravity.ts`: runtime-specific command builders.
- `test/daemon/adapter-worker.test.ts`: deterministic fixture coverage for success, retry, and fatal runtime paths.
- `test/daemon/runtime-adapters.e2e.test.ts`: local end-to-end runtime handoff across codex, open-code, and antigravity identities.

## Next Steps
1. `/execute 4`
2. Start with Plan 4.1 to build operator read models and the daemon inspection surface
3. Keep Node `22.12.0` pinned before any npm command and decide later whether to codify that with `.nvmrc` or Volta

## Notes
- Project initialized through `/new-project`.
- Phase 1 planning assumes TypeScript on Node 22, a root `agent-bus.yaml` manifest, `workspace/` for artifacts, and `.agent-bus/` for internal state.
- Plan 1.1 completed with commits `23ca023` and `a49257f`.
- Plan 1.2 completed with commits `3240c3a`, `7935dce`, and `f4a29f0`.
- Plan 1.3 completed with commits `8368569`, `1a926c0`, and `b08ea22`.
- Plan 1.4 completed with commits `e39b675`, `e6e3d31`, and `300b997`.
- Phase 2 execution completed with commits `8aefba6`, `7babd78`, `1e87746`, `31a930b`, `5cb0d1d`, `a0293c4`, `95c8076`, `a65f3f1`, and `48c3779`.
- Replay invariant fixes landed in commit `10a87f7` and were merged before PR `#1` was merged into PR `#3`.
- Phase 3 execution completed on branch `feature/phase-3-runtime-adapters`; see `.gsd/phases/3/*-SUMMARY.md` and `.gsd/phases/3/VERIFICATION.md` for per-plan commit and evidence details.
- PR `#6` merged Phase 3 into `main` at merge commit `b97691f`; the feature branch was deleted locally and remotely after sync.
