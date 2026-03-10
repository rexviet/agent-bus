---
phase: 4
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - src/cli.ts
  - src/cli/operator-command.ts
  - src/cli/output.ts
  - test/cli/operator-read.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - The CLI keeps existing `daemon`, `layout`, and `validate-manifest` behavior while growing a structured operator command tree.
    - Read-only operator commands expose recent runs, one run's detail view, pending approvals, and failures without custom SQL in the entrypoint.
    - Human-readable text and `--json` output remain consistent across read-only commands.
  artifacts:
    - src/cli/operator-command.ts
    - src/cli/output.ts
    - test/cli/operator-read.test.ts
---

# Plan 4.2: Add Read-Only Operator CLI Commands

<objective>
Turn the new daemon inspection APIs into user-facing commands for run visibility, pending approvals, and failure inspection.

Purpose: REQ-11 is not satisfied until a user can inspect state from the command line without touching SQLite or test helpers.
Output: A structured CLI command router, shared output helpers, and read-only operator commands with deterministic tests.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/4/RESEARCH.md
- .gsd/phases/4/01-PLAN.md
- src/cli.ts
- src/daemon/index.ts
- src/daemon/operator-service.ts
</context>

<tasks>

<task type="auto">
  <name>Refactor the CLI entrypoint into a structured operator command router</name>
  <files>
    src/cli.ts
    src/cli/operator-command.ts
  </files>
  <action>
    Introduce a command-routing layer that can support Phase 4 subcommands without turning `src/cli.ts` into a parser monolith.

    Steps:
    1. Preserve the existing top-level commands and help text while moving operator-command parsing into a dedicated module.
    2. Centralize manifest-path handling and daemon startup for operator commands so read-only and mutating commands use the same bootstrapping path.
    3. Keep argument validation explicit enough that bad subcommands fail with actionable errors instead of silent fallthrough.

    AVOID: leaving Phase 4 entirely inside `src/cli.ts` because read and mutate commands will quickly become hard to reason about.
    USE: a dedicated operator command router because it keeps the entrypoint thin and testable.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The CLI supports a structured operator subcommand tree without regressing the existing top-level commands.
  </done>
</task>

<task type="auto">
  <name>Implement read-only operator commands with shared text and JSON formatting</name>
  <files>
    src/cli.ts
    src/cli/operator-command.ts
    src/cli/output.ts
  </files>
  <action>
    Add the user-facing inspection commands that Phase 4 needs before approval and replay mutations are exposed.

    Steps:
    1. Implement `agent-bus runs list`, `agent-bus runs show <run-id>`, `agent-bus approvals list`, and `agent-bus failures list`.
    2. Add shared formatters so each command can emit concise text by default and stable machine-readable output with `--json`.
    3. Make the commands consume the daemon operator service only, so command handlers remain orchestration-thin.

    AVOID: hand-formatting each command independently because operator output will drift and become harder to automate.
    USE: one output helper layer because it keeps field names and empty-state behavior consistent across commands.
  </action>
  <verify>
    npm run build
  </verify>
  <done>
    A user can inspect recent runs, one run's detail view, pending approvals, and failures from the CLI in either text or JSON form.
  </done>
</task>

<task type="auto">
  <name>Cover read-only CLI behavior with command-level tests</name>
  <files>
    test/cli/operator-read.test.ts
  </files>
  <action>
    Add CLI-level tests that prove command parsing, output, and empty-state behavior over realistic daemon data.

    Steps:
    1. Exercise each read-only command against a temp repository with seeded orchestration state.
    2. Cover both default text output and `--json` output for at least one representative command shape.
    3. Cover invalid run IDs or unknown subcommands so error handling stays user-visible and deterministic.

    AVOID: assuming the lower-level operator-service tests are enough because the command layer still owns parsing and output behavior.
    USE: command-level tests because they prove REQ-11 is reachable from the actual CLI entrypoint.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the read-only operator commands parse correctly, return stable output, and fail clearly on bad input.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Existing top-level CLI commands still work after the parser refactor.
- [ ] Read-only operator commands expose run visibility, pending approvals, and failure inspection in both text and JSON forms.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 4 has a usable read-only operator CLI surface
</success_criteria>
