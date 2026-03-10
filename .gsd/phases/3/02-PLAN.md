---
phase: 3
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - src/adapters/process-runner.ts
  - src/daemon/adapter-worker.ts
  - src/daemon/index.ts
  - src/daemon/publish-event.ts
  - test/daemon/adapter-worker.test.ts
  - test/fixtures/adapters/success-adapter.mjs
  - test/fixtures/adapters/fail-adapter.mjs
autonomous: true
user_setup: []
must_haves:
  truths:
    - The daemon can claim ready work, materialize an adapter work package, execute a local command, and turn the result into ack or fail transitions.
    - Follow-up events emitted by adapters re-enter the same durable publish path instead of bypassing orchestration services.
    - Fixture-based tests prove adapter execution and failure handling without depending on vendor CLIs or external auth.
  artifacts:
    - src/adapters/process-runner.ts
    - src/daemon/adapter-worker.ts
    - test/daemon/adapter-worker.test.ts
---

# Plan 3.2: Wire the Daemon to Execute Adapter Work

<objective>
Turn the Phase 3 contract into a real daemon execution path that can run claimed deliveries through local adapter commands.

Purpose: The adapter contract is only useful if the daemon can own the claim -> execute -> publish -> ack or fail lifecycle.
Output: A generic process runner, a daemon worker loop, and fixture-based tests for success, failure, and emitted-event behavior.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/3/RESEARCH.md
- .gsd/phases/3/01-PLAN.md
- src/daemon/index.ts
- src/daemon/delivery-service.ts
- src/daemon/publish-event.ts
- src/storage/delivery-store.ts
- src/storage/event-store.ts
</context>

<tasks>

<task type="auto">
  <name>Implement the generic process runner for adapter executions</name>
  <files>
    src/adapters/process-runner.ts
  </files>
  <action>
    Build the runtime-agnostic command execution primitive that all concrete adapters will use.

    Steps:
    1. Materialize adapter work-package files and result-file locations under the existing state and logs directories.
    2. Spawn the configured adapter command in the repository or agent working directory with explicit environment variables and log capture.
    3. Return structured execution metadata that the daemon worker can map to acknowledgement, retryable failure, or fatal failure behavior.

    AVOID: baking vendor-specific prompt construction into the generic runner because that would make later adapters mutate the same execution code path.
    USE: a single process runner because it keeps local command execution, log capture, and result-file loading consistent across runtimes.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    A reusable process runner exists that can execute a local adapter command against a serialized work package and load a structured result envelope back from disk.
  </done>
</task>

<task type="auto">
  <name>Wire daemon worker execution to durable delivery and publish services</name>
  <files>
    src/daemon/adapter-worker.ts
    src/daemon/index.ts
    src/daemon/publish-event.ts
  </files>
  <action>
    Connect claimed deliveries to the existing orchestration core instead of inventing a second execution path.

    Steps:
    1. Claim ready deliveries through the existing delivery service and load the persisted event context needed to build an adapter work package.
    2. Run the resolved adapter command and translate its result into acknowledge, retryable fail, fatal fail, and emitted follow-up event behavior.
    3. Ensure follow-up events re-enter the existing durable publish path so approval, retry, and replay semantics remain centralized.

    AVOID: letting adapters publish directly to storage because emitted events must reuse the same orchestration semantics as every other event.
    USE: daemon-owned worker orchestration because Phase 2 already established the correct service boundary for reliability.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    The daemon can execute claimed adapter work, acknowledge or fail deliveries durably, and publish follow-up events through the existing orchestration path.
  </done>
</task>

<task type="auto">
  <name>Add fixture-based tests for success, failure, and emitted-event flow</name>
  <files>
    test/daemon/adapter-worker.test.ts
    test/fixtures/adapters/success-adapter.mjs
    test/fixtures/adapters/fail-adapter.mjs
  </files>
  <action>
    Prove the execution loop works before real vendor CLIs are introduced.

    Steps:
    1. Add fixture adapter commands that consume the shared work package and write deterministic success or failure results.
    2. Test the happy path from ready delivery to acknowledged completion with emitted follow-up events.
    3. Test retryable and fatal failures so the worker path respects the durable delivery lifecycle from Phase 2.

    AVOID: using live vendor CLIs as the only proof of correctness because auth, model config, and machine state would make the tests flaky.
    USE: deterministic fixture commands because they isolate the daemon execution semantics from vendor runtime noise.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the daemon worker loop executes adapter commands, handles failures durably, and republishes emitted events through the event bus.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] The daemon owns the full adapter execution lifecycle from claim through ack or fail.
- [ ] Adapter-emitted follow-up events flow back through the same durable publish path as normal events.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Runtime execution now exists as a first-class daemon capability without depending on vendor CLIs yet
</success_criteria>
