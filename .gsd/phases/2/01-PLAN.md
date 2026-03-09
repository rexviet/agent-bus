---
phase: 2
plan: 1
wave: 1
depends_on: []
files_modified:
  - src/shared/runtime-layout.ts
  - src/shared/paths.ts
  - src/storage/sqlite-client.ts
  - src/storage/migrations/002_orchestration_core.sql
  - src/storage/delivery-store.ts
  - src/storage/approval-store.ts
  - src/daemon/index.ts
  - test/storage/delivery-store.test.ts
  - test/shared/runtime-layout.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Manifest-configured workspace and state paths drive runtime layout and persistence paths.
    - The codebase has durable repositories for deliveries and approvals instead of relying on implicit in-memory orchestration state.
  artifacts:
    - src/storage/migrations/002_orchestration_core.sql
    - src/storage/delivery-store.ts
    - src/storage/approval-store.ts
    - src/shared/runtime-layout.ts
---

# Plan 2.1: Establish Durable Delivery Foundations

<objective>
Turn the Phase 1 skeleton into a durable orchestration substrate by aligning runtime configuration with the manifest and introducing first-class delivery and approval stores.

Purpose: Fan-out, approval, retry, DLQ, and replay will all fail architecturally if runtime layout and durable work state are not authoritative first.
Output: Manifest-driven runtime layout, updated orchestration-core migration, and repository APIs for delivery and approval state.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/1/VERIFICATION.md
- .gsd/phases/2/RESEARCH.md
- src/shared/runtime-layout.ts
- src/storage/migrations/001_initial.sql
- src/storage/event-store.ts
- src/daemon/index.ts
</context>

<tasks>

<task type="auto">
  <name>Make manifest workspace settings authoritative at runtime</name>
  <files>
    src/shared/paths.ts
    src/shared/runtime-layout.ts
    src/storage/sqlite-client.ts
    src/daemon/index.ts
  </files>
  <action>
    Replace the remaining hardcoded runtime layout assumptions with manifest-derived configuration.

    Steps:
    1. Thread manifest workspace directories into runtime layout resolution and DB path selection.
    2. Ensure daemon startup uses the validated manifest as the source of truth for artifact, log, and state locations.
    3. Keep repository-relative safety checks intact when moving from fixed defaults to manifest-driven paths.

    AVOID: leaving a split-brain model where the manifest advertises one layout and the runtime uses another.
    USE: a single runtime-layout contract because every later orchestration service depends on the same path semantics.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Daemon and storage startup resolve layout and database paths from manifest configuration, and tests cover non-default workspace roots.
  </done>
</task>

<task type="auto">
  <name>Introduce orchestration-core schema and repositories for deliveries and approvals</name>
  <files>
    src/storage/migrations/002_orchestration_core.sql
    src/storage/delivery-store.ts
    src/storage/approval-store.ts
  </files>
  <action>
    Add the durable state model that later plans will use for fan-out, approval transitions, retries, DLQ, and replay.

    Steps:
    1. Extend the schema with delivery lifecycle fields such as claimability, scheduling, attempt tracking, lease metadata, and dead-letter context.
    2. Add repository APIs for planning deliveries, reading queue state, updating approval decisions, and inspecting terminal delivery state.
    3. Keep repository methods narrow and explicit so daemon orchestration code can call intent-level operations rather than raw SQL.

    AVOID: encoding retry or approval policy directly into migration-time schema names or repository method names.
    USE: durable repositories because in-memory dispatcher notifications are not sufficient for crash-safe orchestration.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Delivery and approval repositories exist, compile, and expose the primitives needed for fan-out, approval transitions, and recovery.
  </done>
</task>

<task type="auto">
  <name>Add repository tests for runtime-layout and delivery-state foundations</name>
  <files>
    test/shared/runtime-layout.test.ts
    test/storage/delivery-store.test.ts
  </files>
  <action>
    Lock the new orchestration foundation before publish, retry, and replay logic starts depending on it.

    Steps:
    1. Test manifest-driven runtime layout with non-default directories.
    2. Test creation and retrieval of durable delivery and approval state.
    3. Validate that the repository surface preserves intended delivery lifecycle metadata.

    AVOID: waiting until later integration tests to discover that layout or store contracts drifted.
    USE: focused repository tests because this phase needs durable primitives to stay stable under later policy changes.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Tests prove manifest-driven layout and orchestration repositories behave correctly under the new schema.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Runtime layout and DB location follow manifest configuration rather than hidden defaults.
- [ ] Deliveries and approvals have durable repository APIs ready for orchestration policy logic.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] No remaining architecture split exists between manifest config and runtime layout
</success_criteria>
