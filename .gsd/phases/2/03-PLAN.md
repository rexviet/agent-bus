---
phase: 2
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - src/daemon/dispatcher.ts
  - src/daemon/recovery-scan.ts
  - src/daemon/delivery-service.ts
  - src/daemon/index.ts
  - src/storage/delivery-store.ts
  - src/storage/migrations/002_orchestration_core.sql
  - test/daemon/retry-dlq.test.ts
  - test/storage/delivery-store.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Claimable deliveries support at-least-once processing through lease-based claiming, success acknowledgement, and failure transitions.
    - Exhausted delivery attempts move into dead-letter state and recovery scans can reclaim expired work safely.
    - Duplicate publish or delivery planning is detectable and suppressible through durable identifiers and store constraints.
  artifacts:
    - src/daemon/delivery-service.ts
    - src/storage/delivery-store.ts
    - src/daemon/recovery-scan.ts
    - test/daemon/retry-dlq.test.ts
---

# Plan 2.3: Add Retry, Dead-Letter, and Idempotency Controls

<objective>
Implement the durable state machine that gives Agent Bus real at-least-once behavior instead of simple “delivery exists” semantics.

Purpose: Fan-out without claim/retry/idempotency rules is not a usable event bus.
Output: Lease-based claiming, retry scheduling, DLQ transitions, duplicate-suppression rules, and tests for the delivery lifecycle.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/2/RESEARCH.md
- .gsd/phases/2/02-PLAN.md
- src/daemon/recovery-scan.ts
- src/storage/delivery-store.ts
</context>

<tasks>

<task type="auto">
  <name>Implement delivery claiming, acknowledgement, and failure APIs</name>
  <files>
    src/daemon/delivery-service.ts
    src/daemon/index.ts
    src/storage/delivery-store.ts
    src/storage/migrations/002_orchestration_core.sql
  </files>
  <action>
    Add the durable APIs that future runtime adapters will call to process work safely.

    Steps:
    1. Implement claim or lease operations for ready deliveries.
    2. Implement success acknowledgement and failure recording over the same durable work item.
    3. Record enough metadata for attempt tracking, lease expiry, and duplicate detection.

    AVOID: creating adapter-facing APIs that depend on in-memory queue state because adapters need crash-safe work ownership.
    USE: lease-based claiming because it is the simplest SQLite-friendly path to at-least-once semantics.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Delivery work can be claimed, acknowledged, and failed through durable store-backed APIs with explicit lifecycle transitions.
  </done>
</task>

<task type="auto">
  <name>Implement retry scheduling, dead-letter transitions, and recovery reclaim</name>
  <files>
    src/daemon/recovery-scan.ts
    src/daemon/dispatcher.ts
    src/daemon/delivery-service.ts
    src/storage/delivery-store.ts
  </files>
  <action>
    Add reliability policies to the delivery lifecycle without leaking them into adapters.

    Steps:
    1. Schedule retries with deterministic backoff and next-attempt timestamps.
    2. Move exhausted deliveries into dead-letter state with reason metadata.
    3. Extend recovery scan to reclaim expired leases or make eligible retries visible again.

    AVOID: tying retry timing to process-local timers only because the state must survive daemon restarts.
    USE: durable timestamps and status transitions because they are observable, replayable, and testable.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Failed deliveries either become retryable at the correct time or transition into dead-letter state after policy exhaustion, and recovery can reclaim expired work.
  </done>
</task>

<task type="auto">
  <name>Add idempotency and reliability tests for delivery lifecycle edge cases</name>
  <files>
    test/daemon/retry-dlq.test.ts
    test/storage/delivery-store.test.ts
  </files>
  <action>
    Add coverage for the failure and duplicate scenarios that make or break an orchestration core.

    Steps:
    1. Test duplicate planning and duplicate publish suppression behavior.
    2. Test retry scheduling and lease expiry recovery.
    3. Test dead-letter transitions after max-attempt exhaustion.

    AVOID: leaving idempotency rules implicit because duplicate work is one of the core failure modes this phase exists to solve.
    USE: explicit lifecycle tests because they provide the only trustworthy signal that at-least-once semantics really exist.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Tests prove duplicate suppression, retry scheduling, lease reclaim, and dead-letter behavior across the delivery lifecycle.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Deliveries support durable claim, ack, fail, retry, and dead-letter transitions.
- [ ] Duplicate publish or delivery planning is detectably suppressed or rejected.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] At-least-once behavior no longer depends on process-local memory
</success_criteria>
