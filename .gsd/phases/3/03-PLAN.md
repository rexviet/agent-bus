---
phase: 3
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - src/adapters/vendors/codex.ts
  - src/adapters/vendors/open-code.ts
  - src/adapters/registry.ts
  - test/adapters/codex.test.ts
  - test/adapters/open-code.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Codex and Open Code both have concrete adapter builders that translate the shared contract into the command shapes their real CLIs support.
    - The manifest-level runtime identity stays stable even when the installed binary name differs from older examples.
    - Adapter-specific tests freeze command construction, attachment behavior, and prerequisite failures before Antigravity is added.
  artifacts:
    - src/adapters/vendors/codex.ts
    - src/adapters/vendors/open-code.ts
    - test/adapters/codex.test.ts
    - test/adapters/open-code.test.ts
---

# Plan 3.3: Implement Codex and Open Code Adapters

<objective>
Add the first two real runtime adapters using the strongest non-interactive CLI surfaces available on this machine.

Purpose: Codex and Open Code both support direct command execution well enough to prove the adapter architecture before Antigravity's more editor-centric path lands.
Output: Concrete Codex and Open Code adapter builders plus tests that lock down invocation semantics and machine-prerequisite diagnostics.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/3/RESEARCH.md
- .gsd/phases/3/02-PLAN.md
- src/adapters/contract.ts
- src/adapters/process-runner.ts
- src/adapters/registry.ts
- agent-bus.example.yaml
</context>

<tasks>

<task type="auto">
  <name>Implement the Codex adapter around `codex exec`</name>
  <files>
    src/adapters/vendors/codex.ts
    src/adapters/registry.ts
  </files>
  <action>
    Build the Codex-specific adapter builder on top of the shared contract and generic process runner.

    Steps:
    1. Translate the shared work package into a prompt or attached context that tells Codex exactly where to read artifacts and where to write the result envelope.
    2. Build the command invocation around `codex exec` with the correct working directory semantics and deterministic output capture.
    3. Surface clear setup errors for missing binaries or unusable runtime configuration instead of letting the daemon fail opaquely.

    AVOID: depending on conversational stdout parsing because Codex already supports a better non-interactive execution path.
    USE: an explicit adapter builder because it keeps Codex-only flags out of the generic daemon worker path.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The codebase contains a Codex adapter that can build a deterministic `codex exec` invocation from the shared adapter contract and fail clearly when prerequisites are missing.
  </done>
</task>

<task type="auto">
  <name>Implement the Open Code adapter around `opencode run`</name>
  <files>
    src/adapters/vendors/open-code.ts
    src/adapters/registry.ts
  </files>
  <action>
    Build the Open Code adapter without assuming the binary name from older manifest examples is still correct.

    Steps:
    1. Translate the shared work package into an Open Code invocation that sets the working directory and passes context files in the way the installed CLI supports.
    2. Preserve the Agent Bus runtime label `open-code` even if the machine binary is `opencode`.
    3. Keep the adapter compatible with the generic process runner so no daemon logic branches on vendor quirks.

    AVOID: renaming manifest runtime identities just to match one machine's binary name because the adapter layer should absorb that drift.
    USE: a dedicated Open Code adapter builder because it isolates the CLI-specific argument shape cleanly.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The codebase contains an Open Code adapter that resolves the real `opencode` invocation while preserving a stable Agent Bus runtime identity.
  </done>
</task>

<task type="auto">
  <name>Add adapter-specific tests for command construction and prerequisites</name>
  <files>
    test/adapters/codex.test.ts
    test/adapters/open-code.test.ts
  </files>
  <action>
    Lock down the runtime-specific behavior before the last adapter and end-to-end coverage are added.

    Steps:
    1. Test that the Codex adapter generates the expected non-interactive invocation and output-file expectations.
    2. Test that the Open Code adapter generates the expected working-directory and context-file invocation.
    3. Test clear failure paths for missing binaries or missing required configuration so operator debugging is straightforward later.

    AVOID: leaving runtime-specific behavior to implicit manual smoke testing because command drift is likely over time.
    USE: focused adapter tests because they give stable evidence without depending on external runtime availability in CI.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove Codex and Open Code command generation, runtime identity mapping, and prerequisite diagnostics are stable.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Codex and Open Code can both be driven from the same adapter contract through real CLI command builders.
- [ ] Runtime-specific command or binary drift is isolated to adapter modules rather than daemon orchestration code.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Two real runtime adapters exist and are locked down with deterministic tests
</success_criteria>
