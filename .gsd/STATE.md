# STATE.md

> **Current Phase**: 4 - Operator Workflow (next)
> **Current Focus**: Phase 3 is verified and Phase 4 planning is next
> **Last Updated**: 2026-03-10

## Current Position
- **Phase**: 3 (completed)
- **Task**: All tasks complete
- **Status**: Verified (2026-03-10 13:54 +07)

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
- Phase 4 not started

## Last Session Summary
Phase 3 executed successfully. The daemon now owns file-backed runtime adapter execution for Codex, Open Code, and Antigravity, with 4 plans and 12 tasks completed, 45/45 tests passing, and both shipped manifests validated through the compiled CLI.

## In-Progress Work
No product code is currently in progress.
- Branch: `feature/phase-3-runtime-adapters`
- Files modified: runtime adapter contract, process runner, daemon worker execution, vendor builders, shipped manifests, and Phase 3 verification docs
- Tests status: `npm run typecheck`, `npm test`, and manifest validation passed under Node `22.12.0`

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

### Approaches Tried
- Froze the shared adapter contract first with schema and path-safety tests before wiring any runtime execution.
- Added a daemon-owned process runner and worker loop with deterministic fixture adapters covering success, retryable failure, fatal failure, and emitted-event fan-out.
- Implemented vendor-specific builders for `codex`, `opencode`, and `antigravity` while preserving a generic manifest-command fallback for custom wrappers and fixtures.
- Updated the shipped manifests to match real runtime command shapes and validated them through the compiled CLI.
- Proved end-to-end artifact handoff across codex, open-code, and antigravity identities in a temporary local repository and kept smoke checks availability-aware for external CLIs.

### Current Hypothesis
The next highest-value step is Phase 4 planning: operator CLI workflows can now build on top of the stable daemon services and runtime adapter execution path.

### Files of Interest
- `.gsd/phases/3/VERIFICATION.md`: Phase 3 requirement verification and closing evidence.
- `src/adapters/contract.ts`: shared file-backed work package and result envelope contract.
- `src/adapters/process-runner.ts`: local command execution and result-envelope loading.
- `src/daemon/adapter-worker.ts`: daemon-owned claim -> execute -> republish -> ack/fail loop.
- `src/adapters/registry.ts`: runtime registry plus vendor-builder dispatch and generic fallback.
- `src/adapters/vendors/codex.ts`, `src/adapters/vendors/open-code.ts`, `src/adapters/vendors/antigravity.ts`: runtime-specific command builders.
- `test/daemon/adapter-worker.test.ts`: deterministic fixture coverage for success, retry, and fatal runtime paths.
- `test/daemon/runtime-adapters.e2e.test.ts`: local end-to-end runtime handoff across codex, open-code, and antigravity identities.

## Next Steps
1. `/plan 4`
2. Build CLI/operator workflows for approvals, run inspection, failure inspection, and replay on top of the daemon and runtime adapter services
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
- Phase 3 execution completed on branch `feature/phase-3-runtime-adapters`; see `.gsd/phases/3/*-SUMMARY.md` and `.gsd/phases/3/VERIFICATION.md` for per-plan commit and evidence details.
