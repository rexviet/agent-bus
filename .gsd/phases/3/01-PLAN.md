---
phase: 3
plan: 1
wave: 1
depends_on: []
files_modified:
  - src/adapters/contract.ts
  - src/adapters/registry.ts
  - test/adapters/contract.test.ts
  - test/config/manifest.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - Runtime workers receive a stable file-backed work package and return a stable result envelope without touching SQLite directly.
    - Supported runtime families are modeled explicitly in one registry layer instead of leaking vendor assumptions into daemon code.
    - Contract tests lock down artifact-path and emitted-event semantics before execution logic is added.
  artifacts:
    - src/adapters/contract.ts
    - src/adapters/registry.ts
    - test/adapters/contract.test.ts
---

# Plan 3.1: Define the Shared Runtime Adapter Contract

<objective>
Create the adapter contract that every Phase 3 runtime will implement before any real execution path is wired into the daemon.

Purpose: The daemon already owns reliability semantics, so Phase 3 needs a single adapter boundary instead of three ad hoc integrations.
Output: A file-backed work/result schema, runtime registry metadata, and tests that define what a valid adapter exchange looks like.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/3/RESEARCH.md
- .gsd/phases/2/04-PLAN.md
- src/config/manifest-schema.ts
- src/domain/artifact-ref.ts
- src/daemon/index.ts
</context>

<tasks>

<task type="auto">
  <name>Define the daemon-to-adapter work and result envelopes</name>
  <files>
    src/adapters/contract.ts
  </files>
  <action>
    Create the shared contract that every runtime adapter will consume and produce.

    Steps:
    1. Define the work-package shape for a claimed delivery, including delivery metadata, triggering event context, resolved artifact references, workspace roots, and adapter-managed log or result file locations.
    2. Define the result-envelope shape for success, retryable failure, fatal failure, produced artifacts, and follow-up event drafts.
    3. Keep the contract file-backed and runtime-agnostic so the daemon can serialize it once and any vendor adapter can consume it.

    AVOID: giving adapters raw database handles or store APIs because that would break the daemon-owned reliability model from Phase 2.
    USE: explicit schemas for both inbound and outbound files because contract drift is the easiest way to make three runtimes diverge.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    A shared adapter contract exists that can represent claimed work, artifact inputs, output artifacts, emitted events, and failure states without any vendor-specific fields.
  </done>
</task>

<task type="auto">
  <name>Model supported runtime families in one registry layer</name>
  <files>
    src/adapters/registry.ts
  </files>
  <action>
    Add the runtime-family metadata the daemon will use to route work to concrete adapters later.

    Steps:
    1. Model supported runtime families for `codex`, `open-code`, and `antigravity`.
    2. Keep the registry independent from concrete process spawning so later plans can add vendor builders without changing daemon orchestration flow.
    3. Preserve stable Agent Bus runtime identities even when vendor binaries or flags differ across machines.

    AVOID: hardcoding command-line flags or binary names in the registry because those belong in runtime-specific adapter builders.
    USE: a small registry abstraction because it gives the daemon one place to resolve runtime support and clear unsupported-runtime failures.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    The codebase has one explicit registry for supported runtime families, and later daemon code can resolve a runtime without branching on string literals everywhere.
  </done>
</task>

<task type="auto">
  <name>Add tests that freeze contract semantics before execution begins</name>
  <files>
    test/adapters/contract.test.ts
    test/config/manifest.test.ts
  </files>
  <action>
    Add coverage for the contract and manifest assumptions that the rest of Phase 3 will rely on.

    Steps:
    1. Test that adapter work packages preserve repository-relative artifact semantics and reject invalid paths.
    2. Test that result envelopes can express emitted follow-up events and produced artifact metadata cleanly.
    3. Test that supported runtime identities remain explicit at the adapter boundary without tightening manifest parsing beyond existing behavior.

    AVOID: leaving contract behavior implicit because every later adapter bug will become harder to diagnose once process execution is involved.
    USE: dedicated adapter-contract tests because they are the cheapest place to catch cross-runtime shape mismatches.
  </action>
  <verify>
    npm test
  </verify>
  <done>
    Tests prove the adapter contract rejects invalid artifact paths, represents emitted events correctly, and preserves stable runtime-family semantics.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] A single file-backed adapter contract exists for all three runtime families.
- [ ] Runtime-family support and contract semantics are covered by deterministic tests before any vendor process execution lands.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Phase 3 execution can build on one stable adapter boundary instead of ad hoc runtime assumptions
</success_criteria>
