---
phase: 2
plan: 4
wave: 4
depends_on:
  - "03"
files_modified:
  - src/daemon/replay-service.ts
  - src/daemon/index.ts
  - src/storage/delivery-store.ts
  - src/storage/event-store.ts
  - test/daemon/orchestration-core.test.ts
  - test/daemon/retry-dlq.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Historical or failed work can be replayed through application services without manual SQL edits.
    - The daemon exposes service-level orchestration methods that Phase 4 CLI commands can wrap later.
    - End-to-end orchestration tests cover publish, approval, claim, failure, retry, dead-letter, and replay.
  artifacts:
    - src/daemon/replay-service.ts
    - src/daemon/index.ts
    - test/daemon/orchestration-core.test.ts
---

# Plan 2.4: Implement Replay and End-to-End Orchestration Verification

<objective>
Finish the orchestration core by adding replay services and proving the full workflow state machine through end-to-end tests.

Purpose: Replay is a required user-facing reliability primitive even before the broader operator CLI lands in Phase 4.
Output: Replay service APIs, daemon-level orchestration hooks, and end-to-end tests covering the full delivery lifecycle.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/2/RESEARCH.md
- .gsd/phases/2/03-PLAN.md
- src/daemon/index.ts
- src/storage/delivery-store.ts
</context>

<tasks>

<task type="auto">
  <name>Implement replay services for failed or historical delivery work</name>
  <files>
    src/daemon/replay-service.ts
    src/storage/delivery-store.ts
    src/storage/event-store.ts
  </files>
  <action>
    Add explicit replay operations so recovery and operator workflows do not depend on direct database manipulation.

    Steps:
    1. Implement replay operations over persisted event or delivery records.
    2. Preserve enough provenance to explain why replay happened and what work was re-queued.
    3. Keep replay rules narrow so normal retry behavior and explicit replay behavior remain distinct.

    AVOID: implementing replay as undocumented manual row mutation because the requirement explicitly forbids needing DB edits.
    USE: explicit replay services because Phase 4 operator commands should wrap the same service boundary.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Replay APIs exist and can re-queue eligible work from durable state without manual SQL edits.
  </done>
</task>

<task type="auto">
  <name>Expose orchestration-core service hooks through the daemon boundary</name>
  <files>
    src/daemon/index.ts
    src/daemon/replay-service.ts
  </files>
  <action>
    Make the daemon the stable service boundary for orchestration operations that future CLI commands and runtime adapters will call.

    Steps:
    1. Expose daemon methods for approval decisions, queue claims, retryable failure handling, dead-letter inspection, and replay.
    2. Keep the CLI surface intentionally thin so Phase 4 still owns broad operator UX.
    3. Ensure service boundaries are explicit enough that runtime adapters can plug into them later.

    AVOID: baking operator UX decisions into daemon internals this early.
    USE: service-level daemon methods because they decouple orchestration semantics from future CLI or adapter entrypoints.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    The daemon exposes a coherent orchestration service surface for approval, delivery lifecycle actions, and replay.
  </done>
</task>

<task type="auto">
  <name>Add end-to-end orchestration tests for publish through replay</name>
  <files>
    test/daemon/orchestration-core.test.ts
    test/daemon/retry-dlq.test.ts
  </files>
  <action>
    Add a top-level integration path that proves the full orchestration core works together, not just in isolated repository tests.

    Steps:
    1. Cover publish -> approval -> claim -> success for the happy path.
    2. Cover publish -> approval -> claim -> fail -> retry -> dead-letter for the failure path.
    3. Cover explicit replay from dead-letter or terminal failure back to a new claimable state.

    AVOID: declaring orchestration complete based only on unit tests because the value of this phase is end-to-end state-machine correctness.
    USE: scenario-driven daemon tests because they best match the software-delivery workflow the product is designed for.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    End-to-end tests prove the orchestration core supports happy path, failure path, and replay path without manual DB edits.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Replay exists as an application service rather than a manual database operation.
- [ ] The daemon can exercise the full orchestration lifecycle from publish through replay in tests.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 2 ends with a real orchestration core ready for adapter integration in Phase 3
</success_criteria>
