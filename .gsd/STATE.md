# STATE.md

> **Current Phase**: 4 - Operator Workflow (completed)
> **Current Focus**: Phase 4 executed and verified on `feature/phase-4-operator-workflow`; awaiting PR review
> **Last Updated**: 2026-03-10

## Current Position
- **Phase**: 4 - Operator Workflow (completed)
- **Task**: All plans complete
- **Status**: Verified at 2026-03-10 15:15 +07

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
- Phase 4.1 completed
- Phase 4.2 completed
- Phase 4.3 completed
- Phase 4.4 completed
- Phase 4 verification completed

## Last Session Summary
Phase 4 is complete on branch `feature/phase-4-operator-workflow`. The repository now has daemon-backed operator read models, CLI commands for run inspection, approvals, failures, replay, and file-backed publish, plus a deterministic end-to-end operator demo and verification suite.

## In-Progress Work
Product code for Phase 4 is complete and verified.
- Branch: `feature/phase-4-operator-workflow`
- Files modified: CLI/operator surface, demo assets, `.gsd/phases/4/*`, `.gsd/ROADMAP.md`, `.gsd/STATE.md`, `.gsd/JOURNAL.md`
- Tests status: `npm test` passed on Node `22.12.0` with `57/57` tests; manifest validation passed for `agent-bus.example.yaml`, `agent-bus.yaml`, and `examples/operator-demo/agent-bus.demo.yaml`

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
- Nested `--config` paths must still resolve workspace and state directories relative to the caller's repository root, not the config file's parent directory.

### Approaches Tried
- Froze the shared adapter contract first with schema and path-safety tests before wiring any runtime execution.
- Added a daemon-owned process runner and worker loop with deterministic fixture adapters covering success, retryable failure, fatal failure, and emitted-event fan-out.
- Implemented vendor-specific builders for `codex`, `opencode`, and `antigravity` while preserving a generic manifest-command fallback for custom wrappers and fixtures.
- Updated the shipped manifests to match real runtime command shapes and validated them through the compiled CLI.
- Proved end-to-end artifact handoff across codex, open-code, and antigravity identities in a temporary local repository and kept smoke checks availability-aware for external CLIs.
- Re-reviewed the Phase 3 branch after fixing the lease-expiry race and publish-before-ack bug; no remaining blocking findings were found before PR `#6` was merged.

### Current Hypothesis
The implementation work is done; the next step is to review and merge the Phase 4 execution PR after CI passes.

### Files of Interest
- `.gsd/phases/4/VERIFICATION.md`: Phase 4 requirement verification and closing evidence.
- `.gsd/phases/4/RESEARCH.md`: Phase 4 design decisions and operator-surface constraints.
- `.gsd/phases/4/01-PLAN.md`: read-model and daemon operator-service work.
- `.gsd/phases/4/02-PLAN.md`: read-only operator CLI commands.
- `.gsd/phases/4/03-PLAN.md`: approval, rejection, replay, and publish bootstrap CLI commands.
- `.gsd/phases/4/04-PLAN.md`: deterministic end-to-end operator demo workflow.
- `src/daemon/operator-service.ts`: daemon-owned operator read models for runs, approvals, and failures.
- `src/cli.ts`, `src/cli/operator-command.ts`, `src/cli/output.ts`, `src/cli/load-envelope.ts`: the Phase 4 operator CLI surface.
- `examples/operator-demo/agent-bus.demo.yaml`: deterministic demo manifest.
- `test/cli/operator-read.test.ts`, `test/cli/operator-mutate.test.ts`, `test/cli/operator-workflow.e2e.test.ts`: CLI-level verification for read, mutate, and end-to-end operator workflows.

## Next Steps
1. Review the Phase 4 execution PR and CI results
2. Merge after approval
3. Decide whether to codify Node `22.12.0` with `.nvmrc` or Volta

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
