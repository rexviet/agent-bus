---
phase: 1
plan: 4
wave: 4
depends_on:
  - "03"
files_modified:
  - src/daemon/index.ts
  - src/daemon/dispatcher.ts
  - src/daemon/recovery-scan.ts
  - src/daemon/publish-event.ts
  - src/cli.ts
  - test/daemon/daemon-smoke.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - A local daemon can boot with the manifest, ensure runtime layout, initialize storage, and expose a clean skeleton for later dispatch logic.
    - Event publishing persists durably and wakes the local dispatcher path without requiring adapters to poll SQLite directly.
  artifacts:
    - src/daemon/index.ts
    - src/daemon/dispatcher.ts
    - src/daemon/recovery-scan.ts
    - src/daemon/publish-event.ts
    - test/daemon/daemon-smoke.test.ts
---

# Plan 1.4: Implement the Local Daemon Skeleton

<objective>
Create the daemon startup and in-process dispatch skeleton that turns the earlier contracts and storage work into a coherent runtime foundation.

Purpose: Agent Bus needs one local process to own event persistence, wake-up, and recovery instead of forcing every runtime to inspect SQLite directly.
Output: A startable daemon, a publish path, recovery-scan scaffolding, and smoke tests that prove the process boots and persists events cleanly.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/phases/1/RESEARCH.md
- .gsd/phases/1/02-PLAN.md
- .gsd/phases/1/03-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Implement daemon startup and shutdown lifecycle</name>
  <files>
    src/daemon/index.ts
    src/cli.ts
  </files>
  <action>
    Build the daemon bootstrap path that turns the phase contracts into a running local process.

    Steps:
    1. Load and validate the manifest at startup.
    2. Ensure the runtime directories exist, open the database, and run migrations before any dispatch path starts.
    3. Add signal handling and structured shutdown plus an explicit smoke-test flag such as `--exit-after-ready` so verification commands do not hang.

    AVOID: burying startup work inside side-effect imports because the daemon needs explicit lifecycle control.
    USE: a clear bootstrap sequence because future operator commands will depend on predictable startup diagnostics.
  </action>
  <verify>
    npm run build
    node dist/cli.js daemon --config agent-bus.example.yaml --exit-after-ready
  </verify>
  <done>
    The daemon starts from the CLI, validates config, initializes storage, and exits cleanly via a smoke-test flag or shutdown signal.
  </done>
</task>

<task type="auto">
  <name>Create the publish path, dispatcher wake-up, and recovery scan skeleton</name>
  <files>
    src/daemon/dispatcher.ts
    src/daemon/recovery-scan.ts
    src/daemon/publish-event.ts
  </files>
  <action>
    Implement the minimal orchestration loop needed for a durable local foundation without pulling Phase 2 policies forward.

    Steps:
    1. Create a publish path that validates an event, persists it, and notifies the in-process dispatcher queue.
    2. Add dispatcher skeleton logic that can recognize approval-gated versus directly deliverable work, but stop short of full retry and DLQ behavior.
    3. Add a recovery scan loop that periodically re-loads pending work after startup or missed wake-ups.

    AVOID: making adapters query SQLite for work because the architecture goal is daemon-owned dispatch, not database polling by every runtime.
    USE: an in-process wake-up path plus recovery scan because it keeps hot-path latency low while preserving crash recovery.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Publishing an event persists it and reaches the dispatcher skeleton path, while recovery scan scaffolding exists for restart recovery.
  </done>
</task>

<task type="auto">
  <name>Add daemon smoke tests for startup and durable publish</name>
  <files>
    test/daemon/daemon-smoke.test.ts
  </files>
  <action>
    Add smoke coverage that proves the daemon foundation actually wires together the earlier work.

    Steps:
    1. Boot the daemon against a temporary workspace and database.
    2. Publish a sample event and assert that it is persisted plus visible to the dispatcher skeleton or approval queue state.
    3. Confirm clean shutdown without leaked handles or broken temp-state cleanup.

    AVOID: leaving daemon verification to manual CLI testing because lifecycle bugs are easy to miss and expensive later.
    USE: narrow smoke tests because they protect the phase boundary without forcing Phase 2 behavior into Phase 1.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Smoke tests prove the daemon boots, persists a sample event, and shuts down cleanly using a temporary runtime layout.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] The project has a runnable daemon bootstrap path grounded in the manifest and storage layers.
- [ ] Event publication wakes local dispatch without requiring direct SQLite polling by adapters.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 1 finishes with a startable local daemon skeleton, not just isolated modules
</success_criteria>
