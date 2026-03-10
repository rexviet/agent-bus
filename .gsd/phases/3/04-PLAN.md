---
phase: 3
plan: 4
wave: 4
depends_on:
  - "03"
files_modified:
  - src/adapters/vendors/antigravity.ts
  - src/adapters/registry.ts
  - agent-bus.example.yaml
  - agent-bus.yaml
  - test/adapters/antigravity.test.ts
  - test/daemon/runtime-adapters.e2e.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Antigravity is integrated through the same shared contract even though its CLI is more editor-centric than the other two runtimes.
    - The repository manifests reflect real runtime command shapes instead of stale placeholder commands.
    - End-to-end coverage proves shared-workspace artifact handoff and emitted-event flow across the runtime adapter stack.
  artifacts:
    - src/adapters/vendors/antigravity.ts
    - agent-bus.example.yaml
    - test/daemon/runtime-adapters.e2e.test.ts
---

# Plan 3.4: Add Antigravity and Finalize End-to-End Adapter Coverage

<objective>
Complete Phase 3 by integrating Antigravity, updating the shipped manifests to real runtime commands, and proving the adapter stack works end to end.

Purpose: Phase 3 is only complete when all three required runtimes participate through the same shared workspace and daemon-owned orchestration model.
Output: An Antigravity adapter, corrected repository manifests, and end-to-end verification of artifact handoff and follow-up event publication.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/3/RESEARCH.md
- .gsd/phases/3/03-PLAN.md
- src/adapters/contract.ts
- src/adapters/process-runner.ts
- src/adapters/registry.ts
- agent-bus.example.yaml
- agent-bus.yaml
</context>

<tasks>

<task type="auto">
  <name>Implement the Antigravity adapter around `antigravity chat --mode agent`</name>
  <files>
    src/adapters/vendors/antigravity.ts
    src/adapters/registry.ts
  </files>
  <action>
    Build the highest-risk adapter on top of the same file-backed contract instead of inventing a special execution path.

    Steps:
    1. Translate the shared work package into an Antigravity invocation that points the runtime at the repository context, artifact inputs, and result-envelope location.
    2. Add guardrails for editor-centric behavior so missing binaries, unexpected exits, or missing result files fail with explicit diagnostics.
    3. Keep Antigravity inside the same adapter registry and process-runner flow as the other runtimes.

    AVOID: treating Antigravity stdout or editor state as the system of record because its CLI surface is less structured than Codex or Open Code.
    USE: the same file-backed result contract because it is the only cross-runtime boundary strong enough to survive CLI differences.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The codebase contains an Antigravity adapter that plugs into the shared contract and fails loudly when the editor-style runtime does not produce the expected result envelope.
  </done>
</task>

<task type="auto">
  <name>Update shipped manifests to real runtime command shapes</name>
  <files>
    agent-bus.example.yaml
    agent-bus.yaml
  </files>
  <action>
    Bring the repository configuration in line with the actual runtime command surfaces discovered during research.

    Steps:
    1. Replace stale placeholder commands with the real command forms for Codex, Open Code, and Antigravity.
    2. Keep runtime identities and artifact conventions aligned with the adapter contract from earlier plans.
    3. Make the sample workflow reflect how a real one-machine repository would invoke the three runtimes together.

    AVOID: leaving the shipped manifests on placeholder commands because that would make the first real workflow fail immediately.
    USE: repository-local examples that match the implemented adapter behavior because the manifest is part of the product surface.
  </action>
  <verify>
    npm run build && node --experimental-sqlite dist/cli.js validate-manifest agent-bus.example.yaml
  </verify>
  <done>
    Both repository manifests reference real runtime command shapes and still validate through the compiled CLI.
  </done>
</task>

<task type="auto">
  <name>Add end-to-end adapter tests and availability-aware smoke coverage</name>
  <files>
    test/adapters/antigravity.test.ts
    test/daemon/runtime-adapters.e2e.test.ts
  </files>
  <action>
    Finish the phase with proof that the shared workspace contract works across the adapter stack, not just in isolated command-builder tests.

    Steps:
    1. Add deterministic end-to-end tests that run fixture adapters through the daemon and assert artifact handoff plus follow-up event publication.
    2. Add focused Antigravity adapter tests for command generation and missing-result diagnostics.
    3. Where practical, add smoke checks that skip cleanly when live runtime binaries or auth are unavailable instead of making CI flaky.

    AVOID: declaring Phase 3 complete based only on unit-level command builder tests because the product promise is end-to-end workflow participation.
    USE: deterministic end-to-end tests first, with optional smoke checks layered on top, because that balances reliability with real-runtime confidence.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the daemon can hand work through the shared adapter contract, collect artifacts, and republish follow-up events across the runtime adapter path.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Codex, Open Code, and Antigravity all participate through one shared adapter contract.
- [ ] Shared-workspace artifact handoff and follow-up event publication are proven end to end.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 3 ends with real runtime adapter integrations ready for operator workflows in Phase 4
</success_criteria>
