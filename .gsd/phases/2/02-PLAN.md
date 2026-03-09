---
phase: 2
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - src/daemon/publish-event.ts
  - src/daemon/dispatcher.ts
  - src/daemon/index.ts
  - src/daemon/subscription-planner.ts
  - src/daemon/approval-service.ts
  - src/storage/event-store.ts
  - src/storage/delivery-store.ts
  - src/storage/approval-store.ts
  - test/daemon/publish-fanout.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Publishing an event resolves all matching subscribers and creates durable delivery work items for each target.
    - Approval-gated topics enter pending approval and only become deliverable after an explicit approve transition.
  artifacts:
    - src/daemon/subscription-planner.ts
    - src/daemon/approval-service.ts
    - src/daemon/publish-event.ts
    - test/daemon/publish-fanout.test.ts
---

# Plan 2.2: Implement Durable Fan-Out and Approval Gates

<objective>
Build the orchestration behavior that turns one published event into durable per-subscriber work, while correctly respecting human approval gates.

Purpose: This is the first point where Agent Bus behaves like an event bus rather than a local event log.
Output: Subscriber planning, publish-time delivery creation, and approve/reject transitions over durable queue state.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/2/RESEARCH.md
- .gsd/phases/2/01-PLAN.md
- src/daemon/publish-event.ts
- src/storage/event-store.ts
- src/config/manifest-schema.ts
</context>

<tasks>

<task type="auto">
  <name>Plan durable subscriber deliveries at publish time</name>
  <files>
    src/daemon/subscription-planner.ts
    src/daemon/publish-event.ts
    src/storage/event-store.ts
    src/storage/delivery-store.ts
  </files>
  <action>
    Make publish resolve subscriptions from the manifest and persist one delivery record per matching subscriber.

    Steps:
    1. Build a subscription-planning service that resolves matching subscribers for a topic and records the intended targets deterministically.
    2. Persist delivery work items during publish so fan-out survives daemon restarts.
    3. Distinguish approval-gated versus immediately deliverable work at creation time.

    AVOID: calculating subscribers only in memory because that loses durable fan-out intent on crash or restart.
    USE: publish-time delivery planning because approval and replay both need a durable subscriber snapshot.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Publishing an event creates durable delivery work items for all matching subscribers with the correct initial delivery state.
  </done>
</task>

<task type="auto">
  <name>Implement approval decision transitions over delivery state</name>
  <files>
    src/daemon/approval-service.ts
    src/daemon/index.ts
    src/storage/approval-store.ts
    src/storage/delivery-store.ts
  </files>
  <action>
    Add explicit approve and reject transitions so human-gated events stop being dead metadata and actually control delivery readiness.

    Steps:
    1. Implement approve and reject services over the persisted approval and delivery rows.
    2. Ensure approval unlocks blocked deliveries and rejection records feedback while preventing accidental downstream execution.
    3. Expose the new orchestration methods through daemon-level service APIs for tests and future operator commands.

    AVOID: encoding approval behavior only in dispatcher notifications because approval is a durable workflow state change.
    USE: explicit approval transitions because later CLI and adapter layers will depend on the same durable semantics.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Approval and rejection transitions change both approval status and downstream delivery readiness in durable state.
  </done>
</task>

<task type="auto">
  <name>Add integration tests for publish fan-out and approval gating</name>
  <files>
    test/daemon/publish-fanout.test.ts
  </files>
  <action>
    Add orchestration-level tests that prove the publish path now produces durable queue state instead of in-memory-only notifications.

    Steps:
    1. Cover fan-out to multiple subscribers for the same topic.
    2. Cover approval-gated events remaining blocked before approval.
    3. Cover approval unlocking deliveries and rejection cancelling or suppressing them.

    AVOID: relying only on repository tests because this behavior spans manifest resolution, persistence, and daemon service boundaries.
    USE: focused integration tests because Phase 2 is about orchestration correctness, not just data storage.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Tests prove that publish fan-out and approval gates behave correctly across manifest, daemon, and persistence layers.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Publish creates durable fan-out work for matching subscribers.
- [ ] Approval state controls whether downstream deliveries are blocked or released.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] No orchestration-critical behavior exists only in transient in-memory state
</success_criteria>
