---
phase: 4
plan: 1
wave: 1
depends_on: []
files_modified:
  - src/storage/run-store.ts
  - src/storage/event-store.ts
  - src/storage/delivery-store.ts
  - src/daemon/operator-service.ts
  - src/daemon/index.ts
  - test/storage/run-store.test.ts
  - test/storage/event-store.test.ts
  - test/storage/delivery-store.test.ts
  - test/daemon/operator-service.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Operator inspection reads durable state through daemon-owned queries instead of direct CLI database access.
    - Run views are derived from persisted events and deliveries, so operator output is not limited by the current lightweight run-status writes.
    - Failure inspection exposes replay-relevant metadata such as last error, delivery status, attempt count, and replay provenance.
  artifacts:
    - src/daemon/operator-service.ts
    - src/daemon/index.ts
    - test/daemon/operator-service.test.ts
---

# Plan 4.1: Establish Operator Read Models and Daemon Inspection APIs

<objective>
Create the read-side operator boundary that Phase 4 CLI commands will use for run visibility, pending approvals, and failure inspection.

Purpose: The orchestration core already persists the required audit data, but Phase 4 needs operator-friendly query shapes before any user-facing command work begins.
Output: Expanded store queries, a daemon-owned operator service, and deterministic tests that lock the read-model semantics.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/4/RESEARCH.md
- .gsd/phases/2/04-PLAN.md
- src/daemon/index.ts
- src/storage/run-store.ts
- src/storage/event-store.ts
- src/storage/delivery-store.ts
</context>

<tasks>

<task type="auto">
  <name>Expand durable query primitives for runs, events, and replay-relevant deliveries</name>
  <files>
    src/storage/run-store.ts
    src/storage/event-store.ts
    src/storage/delivery-store.ts
  </files>
  <action>
    Add the store-level queries required for operator inspection without exposing raw SQL outside the storage layer.

    Steps:
    1. Add list and lookup primitives for runs and events that let the operator layer retrieve recent runs and the event timeline for one run.
    2. Add delivery queries that surface failure and replay metadata, including retry-scheduled and dead-letter work with last-error context.
    3. Keep the storage APIs small and composable so later operator views can be assembled from durable records instead of duplicating query logic in the CLI.

    AVOID: embedding presentation-specific sorting or formatting decisions into the stores because that would make the operator layer harder to evolve.
    USE: explicit query methods for run timelines and failure inspection because Phase 4 commands need durable, testable read semantics.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The storage layer can list runs, fetch one run's events, and list failure or replay-relevant deliveries without any CLI-owned database knowledge.
  </done>
</task>

<task type="auto">
  <name>Compose operator-friendly read models behind a daemon-owned service</name>
  <files>
    src/daemon/operator-service.ts
    src/daemon/index.ts
  </files>
  <action>
    Add a daemon-level operator service that turns low-level records into stable read models for Phase 4 commands.

    Steps:
    1. Create a dedicated operator service that composes run, event, approval, and delivery records into run summaries, run detail views, pending approvals, and failure lists.
    2. Expose the operator service through `startDaemon()` so CLI commands can stay thin and never reach into stores directly.
    3. Derive run status summaries from persisted event and delivery state where needed instead of assuming `runs.status` is already lifecycle-complete.

    AVOID: moving mutation rules into the operator service because approval, replay, and delivery lifecycle semantics already belong to existing services.
    USE: a dedicated read service because it gives Phase 4 one stable operator boundary instead of several ad hoc store calls.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    The daemon exposes operator-facing run, approval, and failure inspection methods that are rich enough for the planned CLI commands.
  </done>
</task>

<task type="auto">
  <name>Freeze operator read-model behavior with deterministic tests</name>
  <files>
    test/storage/run-store.test.ts
    test/storage/event-store.test.ts
    test/storage/delivery-store.test.ts
    test/daemon/operator-service.test.ts
  </files>
  <action>
    Add deterministic tests that pin the operator inspection semantics before CLI output depends on them.

    Steps:
    1. Cover recent-run listing and run-detail retrieval over persisted events and deliveries.
    2. Cover failure views for retry-scheduled and dead-letter deliveries, including last-error and replay counters.
    3. Cover pending approvals and derived run summaries so the read-side contract stays stable when later commands are added.

    AVOID: relying only on CLI tests for read-model correctness because operator bugs are harder to localize once parsing and formatting are involved.
    USE: focused store and daemon tests because they isolate read-side regressions before Phase 4 command work begins.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the operator layer can explain current runs, pending approvals, and replayable failures from durable state alone.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Operator inspection reads through daemon-owned services instead of direct CLI database access.
- [ ] Run and failure views are backed by deterministic read-model tests before any CLI formatting work begins.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 4 has a stable read-side boundary for run visibility, approvals, and failure inspection
</success_criteria>
