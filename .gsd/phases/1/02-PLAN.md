---
phase: 1
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - agent-bus.yaml
  - agent-bus.example.yaml
  - src/cli.ts
  - src/config/manifest-schema.ts
  - src/config/load-manifest.ts
  - src/domain/event-envelope.ts
  - src/domain/artifact-ref.ts
  - test/config/manifest.test.ts
  - test/domain/event-envelope.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - The project has a single typed manifest contract for agents, subscriptions, approval gates, commands, and workspace conventions.
    - Events are represented by a validated envelope that carries metadata and relative artifact references instead of inline artifact content.
  artifacts:
    - agent-bus.example.yaml
    - src/config/manifest-schema.ts
    - src/config/load-manifest.ts
    - src/domain/event-envelope.ts
    - src/domain/artifact-ref.ts
---

# Plan 1.2: Define Manifest and Event Contracts

<objective>
Lock down the typed contracts for repository configuration and event payloads so the rest of the runtime can build on stable shapes instead of untyped objects.

Purpose: Manifest and event contracts are the boundary between human-authored workflows, daemon logic, and future runtime adapters.
Output: A validated YAML manifest loader, an example manifest, typed event-envelope modules, and tests for both contracts.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/1/RESEARCH.md
- .gsd/phases/1/01-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Create the manifest schema, loader, and example manifest</name>
  <files>
    agent-bus.yaml
    agent-bus.example.yaml
    src/cli.ts
    src/config/manifest-schema.ts
    src/config/load-manifest.ts
  </files>
  <action>
    Implement the repository-local workflow manifest as a typed, validated config surface.

    Steps:
    1. Define Zod schemas for agents, subscriptions, approval gates, commands, workspace roots, and artifact conventions.
    2. Parse YAML into a validated manifest object with clear validation errors.
    3. Wire a `validate-manifest` CLI command that exercises the loader against a supplied manifest path.
    4. Commit a realistic example manifest that models the BA -> tech lead + QA -> coder flow described in the project spec.

    AVOID: accepting loosely typed `Record<string, unknown>` configs because invalid manifests must fail before daemon startup.
    USE: one canonical schema module because every later subsystem should depend on the same manifest contract.
  </action>
  <verify>
    npm run build
    node dist/cli.js validate-manifest agent-bus.example.yaml
  </verify>
  <done>
    The example manifest validates successfully, and invalid manifest input produces structured, actionable errors.
  </done>
</task>

<task type="auto">
  <name>Define the event envelope and artifact reference helpers</name>
  <files>
    src/domain/event-envelope.ts
    src/domain/artifact-ref.ts
  </files>
  <action>
    Create the event contract used by publishers, the daemon, and future adapters.

    Steps:
    1. Define the typed envelope fields for topic, event ID, run ID, correlation and causation IDs, producer metadata, payload metadata, dedupe key, and artifact references.
    2. Enforce that artifact references are relative paths and never embed full artifact contents.
    3. Provide helper functions for normalizing and validating artifact paths against the shared workspace rules.

    AVOID: mixing artifact bytes into event payloads because the product explicitly separates events from file-based handoff.
    USE: explicit domain helpers because idempotency and replay logic later depend on stable identifiers and path rules.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The event envelope is typed and validated, and artifact helpers reject absolute or escaping paths.
  </done>
</task>

<task type="auto">
  <name>Add contract tests for manifest and event parsing</name>
  <files>
    test/config/manifest.test.ts
    test/domain/event-envelope.test.ts
  </files>
  <action>
    Add focused tests that lock the foundation contracts before storage or daemon code starts depending on them.

    Steps:
    1. Cover successful parsing of the example manifest.
    2. Cover failures for invalid subscriptions, invalid approval gate configuration, and invalid artifact paths.
    3. Cover event-envelope validation for required identifiers and metadata.

    AVOID: deferring contract tests because later plans will otherwise hide schema drift behind integration code.
    USE: small deterministic tests because these contracts should remain cheap to verify on every change.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Tests pass and fail for the intended invalid cases, proving the contract layer rejects malformed config and event input.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] A repository-root manifest can be parsed and validated from YAML.
- [ ] The event envelope carries metadata plus relative artifact refs, not inline artifact content.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Manifest and event contracts are covered by tests
</success_criteria>
