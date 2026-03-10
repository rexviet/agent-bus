---
phase: 4
plan: 4
wave: 4
depends_on:
  - "03"
files_modified:
  - docs/operator-workflow-demo.md
  - examples/operator-demo/agent-bus.demo.yaml
  - examples/operator-demo/envelopes/plan-done.json
  - test/fixtures/agents/demo-agent.mjs
  - test/cli/operator-workflow.e2e.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - The repository contains a deterministic Phase 4 demo that exercises the real CLI operator surface end to end.
    - Demo verification covers publish, pending approval inspection, approval, failure inspection, replay, and final artifact success in one workflow.
    - Demo assets stay aligned with the shipped workflow shape instead of inventing an unrelated toy scenario.
  artifacts:
    - docs/operator-workflow-demo.md
    - examples/operator-demo/agent-bus.demo.yaml
    - test/cli/operator-workflow.e2e.test.ts
---

# Plan 4.4: Deliver the End-to-End Operator Workflow Demo

<objective>
Prove the full Phase 4 operator workflow through deterministic demo assets, end-to-end CLI tests, and a documented walkthrough.

Purpose: Phase 4 only closes cleanly when a user can see the complete operator loop, not just isolated commands.
Output: Demo manifest and envelope assets, fixture agents, an end-to-end CLI test, and a documented operator walkthrough.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/4/RESEARCH.md
- .gsd/phases/4/03-PLAN.md
- agent-bus.example.yaml
- src/cli.ts
- src/daemon/adapter-worker.ts
</context>

<tasks>

<task type="auto">
  <name>Create deterministic demo assets that mirror the shipped workflow shape</name>
  <files>
    docs/operator-workflow-demo.md
    examples/operator-demo/agent-bus.demo.yaml
    examples/operator-demo/envelopes/plan-done.json
    test/fixtures/agents/demo-agent.mjs
  </files>
  <action>
    Add the repository assets needed to run and explain a deterministic operator demo without external runtime dependencies.

    Steps:
    1. Create a demo manifest that mirrors the existing `plan_done` approval fan-out and downstream artifact flow, but uses generic manifest commands pointed at local fixture agents.
    2. Add a seed envelope file for the workflow bootstrap command and fixture-agent logic that can deterministically succeed, fail once, and then succeed after replay.
    3. Keep the demo assets repository-local and file-based so they exercise the same contract as the main product flow.

    AVOID: using a fake scenario that ignores approvals or artifact refs because that would not prove the real product requirement.
    USE: the existing workflow topics and artifact conventions because the demo should reinforce, not bypass, the shipped manifest model.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The repository contains a deterministic demo manifest, envelope, and fixture agent implementation that can drive the Phase 4 operator workflow locally.
  </done>
</task>

<task type="auto">
  <name>Add an end-to-end CLI scenario for publish through replay and artifact completion</name>
  <files>
    test/cli/operator-workflow.e2e.test.ts
    test/fixtures/agents/demo-agent.mjs
  </files>
  <action>
    Add the main verification path that proves the operator loop works through the actual CLI surface.

    Steps:
    1. Drive the workflow with CLI commands: publish the seed envelope, inspect the pending approval, approve it, inspect the induced failure, replay it, and confirm the workflow completes.
    2. Assert on both CLI-visible state and resulting workspace artifacts so the demo proves operational visibility and actual work completion.
    3. Keep the scenario deterministic and temp-repository based so CI can run it without external accounts or background services.

    AVOID: short-circuiting through daemon test helpers once the scenario starts because Phase 4 must prove the CLI surface, not just the underlying services.
    USE: one end-to-end command path because it best matches the real operator journey required by the spec.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    One deterministic test proves the operator can publish, inspect, approve, inspect failures, replay, and observe final artifact completion entirely through CLI commands.
  </done>
</task>

<task type="auto">
  <name>Document the operator demo workflow as a repeatable repository walkthrough</name>
  <files>
    docs/operator-workflow-demo.md
  </files>
  <action>
    Write the user-facing walkthrough that explains how to run the deterministic demo and what each command should show.

    Steps:
    1. Document setup prerequisites, the demo manifest, and the seed envelope file.
    2. Document the exact publish, inspect, approve, failure-inspect, and replay commands in execution order.
    3. Document the expected artifact outputs and the failure or replay checkpoints so future users can validate the workflow manually when needed.

    AVOID: describing the demo only through tests because the end user still needs an operational walkthrough.
    USE: a concise repository doc because it turns Phase 4 from an implementation detail into a usable workflow.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    The repository contains a clear walkthrough for the deterministic operator workflow demo, including commands, checkpoints, and expected artifacts.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] The repository contains a deterministic demo workflow that exercises the real Phase 4 CLI surface.
- [ ] End-to-end verification covers publish, approval, failure inspection, replay, and final artifact completion.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 4 ends with a demonstrable operator workflow instead of isolated commands
</success_criteria>
