---
phase: 4
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - src/cli.ts
  - src/cli/operator-command.ts
  - src/cli/output.ts
  - src/cli/load-envelope.ts
  - test/cli/operator-mutate.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Approval and rejection commands preserve actor attribution and rejection feedback through the same daemon services used by the orchestration core.
    - Replay commands expose whether an event or delivery was actually replayed and surface replay metadata back to the operator.
    - Workflow bootstrap stays thin by loading a file-backed event envelope instead of introducing a flag-heavy event builder.
  artifacts:
    - src/cli/operator-command.ts
    - src/cli/load-envelope.ts
    - test/cli/operator-mutate.test.ts
---

# Plan 4.3: Add Mutating Operator Commands and CLI Workflow Bootstrap

<objective>
Complete the operator command surface with approval, rejection, replay, and a thin publish bootstrap that can start demo runs from the CLI.

Purpose: Phase 4 is only operationally complete once a user can act on pending work and trigger replay without touching internals.
Output: Mutating operator commands, envelope-file loading, and CLI tests that cover approval, rejection feedback, replay, and workflow bootstrap.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/4/RESEARCH.md
- .gsd/phases/4/02-PLAN.md
- src/cli.ts
- src/cli/operator-command.ts
- src/daemon/index.ts
- src/domain/event-envelope.ts
</context>

<tasks>

<task type="auto">
  <name>Implement approval and replay mutation commands over the daemon boundary</name>
  <files>
    src/cli.ts
    src/cli/operator-command.ts
    src/cli/output.ts
  </files>
  <action>
    Add the mutation commands operators need for pending approvals and replayable failures.

    Steps:
    1. Implement `agent-bus approvals approve <approval-id> --by <actor>` and `agent-bus approvals reject <approval-id> --by <actor> --feedback <text>`.
    2. Implement `agent-bus replay delivery <delivery-id>` and `agent-bus replay event <event-id>` using the existing daemon replay APIs.
    3. Format the mutation results so operators can see the resulting approval decision, delivery status, and replay counters without inspecting the database.

    AVOID: bypassing daemon services or re-encoding replay rules in CLI code because the orchestration core already owns those invariants.
    USE: explicit actor and feedback flags because approval decisions are part of the audit trail, not just side effects.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    Operators can approve, reject with feedback, replay deliveries, and replay events from the CLI while seeing the resulting durable state.
  </done>
</task>

<task type="auto">
  <name>Add a thin file-backed publish bootstrap for demo and operator smoke flows</name>
  <files>
    src/cli.ts
    src/cli/operator-command.ts
    src/cli/load-envelope.ts
  </files>
  <action>
    Add the smallest publish surface needed to start a workflow from the CLI without building a large event-construction DSL.

    Steps:
    1. Implement `agent-bus publish --envelope <file>` where the file contains a JSON event envelope that is validated through the existing domain parser.
    2. Resolve the envelope path relative to the current working directory or repository root consistently with the rest of the CLI.
    3. Return the persisted event and run identifiers so the user can immediately inspect the new workflow with the read-only commands from Plan 4.2.

    AVOID: inventing a flag-per-field event builder because it expands scope and drifts away from the project's file-based artifact model.
    USE: a file-backed envelope loader because it keeps workflow bootstrap explicit, testable, and easy to script.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    A user can start a workflow from a validated envelope file and immediately inspect the resulting run and event identifiers from the CLI.
  </done>
</task>

<task type="auto">
  <name>Cover mutating CLI commands with command-level tests and guardrails</name>
  <files>
    test/cli/operator-mutate.test.ts
  </files>
  <action>
    Add CLI tests that pin mutation behavior and error handling before the end-to-end demo is assembled.

    Steps:
    1. Cover approval and rejection, including required actor identity and preserved rejection feedback.
    2. Cover replay commands for both allowed and blocked states, including replay attempts against rejected approval flows.
    3. Cover `publish --envelope` success and invalid-envelope failures so the bootstrap path is safe to use in Phase 4 demos.

    AVOID: relying on manual smoke checks for mutation commands because replay and approval failures are exactly the flows most likely to regress.
    USE: command-level tests because they prove the operator CLI honors the same invariants as the daemon services underneath it.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the mutating operator commands preserve audit data, reject invalid states clearly, and can bootstrap a workflow from an envelope file.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Approval, rejection, replay, and publish bootstrap commands all execute through daemon-owned services.
- [ ] Mutation commands preserve audit fields and reject blocked replay paths with clear operator-facing errors.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 4 has a complete mutating operator CLI surface ready for demo verification
</success_criteria>
