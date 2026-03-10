---
phase: 4
researched_at: 2026-03-10
discovery_level: 0
---

# Phase 4 Research

## Objective
Determine the thinnest operator CLI and demo workflow that satisfies REQ-11 on top of the already-shipped orchestration and runtime-adapter services.

## Discovery Level
**Level 0** — Skip external research, because Phase 4 is pure internal product work on top of existing daemon, storage, and CLI boundaries.

## Key Decisions

### Decision 1: Add operator read models behind the daemon boundary before expanding CLI commands
**Question:** Where should run, approval, and failure inspection logic live?
**Options Considered:**
1. Query SQLite directly from CLI code: fastest to spike, but it leaks storage details into the operator surface and duplicates daemon knowledge.
2. Reuse only the current daemon methods: better boundary discipline, but the existing surface is too narrow for run summaries and failure inspection.
3. Extend store query APIs and compose them through a daemon-owned operator service: keeps orchestration semantics in one place and gives the CLI a stable read contract.

**Decision:** Extend the read-side store APIs and expose operator-friendly queries through a daemon-owned operator service.
**Confidence:** High

### Decision 2: Derive run inspection summaries from current event and delivery state instead of inventing a new run lifecycle first
**Question:** How should Phase 4 report run state when `runs.status` is currently written only at creation time?
**Options Considered:**
1. Trust the stored run status as the operator truth: easy, but misleading because runs currently stay `active`.
2. Add broad run lifecycle writes everywhere in Phase 4: possible, but it expands scope beyond the operator workflow requirement.
3. Build operator summaries from persisted events and deliveries first, and only add run-status writes later if a real gap remains.

**Decision:** Derive operator run summaries from event and delivery state first.
**Confidence:** Medium

### Decision 3: Keep the operator CLI scriptable with shared formatting and a file-based publish bootstrap
**Question:** What command surface best fits approval, replay, and demo workflows?
**Options Considered:**
1. Human-only text output and many ad hoc flags: quick to wire, but brittle for automation and hard to test.
2. Shared text output plus `--json`, with a thin `publish --envelope <file>` bootstrap: consistent, scriptable, and aligned with the project's file-based workflow model.
3. Build a rich interactive TUI first: attractive later, but unnecessary for V1 and outside scope.

**Decision:** Use a thin subcommand CLI with shared formatters, `--json` support, and `publish --envelope <file>` for workflow bootstrap.
**Confidence:** High

### Decision 4: Make the demo deterministic with fixture agents and generic manifest commands
**Question:** How should Phase 4 prove the operator workflow without depending on authenticated external runtimes?
**Options Considered:**
1. Require real Codex, Open Code, and Antigravity in CI: closest to production, but unreliable and auth-sensitive.
2. Skip end-to-end verification entirely: faster now, but it weakens the only user-facing proof of the operator workflow.
3. Use generic manifest commands plus local fixture agent scripts for deterministic CLI-driven demos and tests.

**Decision:** Use deterministic fixture agents for demo and test coverage while keeping real-runtime manifests as reference artifacts.
**Confidence:** High

## Findings

### Current CLI has no operator workflow surface yet
The shipped CLI only supports `daemon`, `layout`, and `validate-manifest`. There are no commands yet for run inspection, approvals, failure inspection, replay, or workflow bootstrap.

**Sources:**
- Local code inspection on 2026-03-10:
  - `src/cli.ts`

### The daemon already exposes most mutation semantics Phase 4 needs
Approval, rejection, replay, publish, and event-specific delivery lookup already exist at the daemon boundary. Phase 4 does not need to redesign orchestration semantics; it mainly needs query composition and a user-facing command surface.

**Sources:**
- Local code inspection on 2026-03-10:
  - `src/daemon/index.ts`
  - `.gsd/phases/2/04-PLAN.md`
  - `.gsd/phases/2/04-SUMMARY.md`

### The storage layer already persists the right audit data, but not the right operator queries
Approval decisions already persist `decidedBy` and optional rejection feedback. Deliveries already persist retry, dead-letter, last-error, and replay metadata. Events already carry producer, artifact, and approval context. The gap is that the stores only expose narrow access patterns, which is insufficient for operator views.

**Sources:**
- Local code inspection on 2026-03-10:
  - `src/storage/run-store.ts`
  - `src/storage/event-store.ts`
  - `src/storage/approval-store.ts`
  - `src/storage/delivery-store.ts`

### Generic manifest command fallback enables a hermetic demo path
If an agent runtime is unsupported or the executable does not match a vendor-specific builder, the adapter layer falls back to the manifest command directly. That gives Phase 4 a clean way to run deterministic fixture agents in tests and example workflows without changing the core adapter contract.

**Sources:**
- Local code inspection on 2026-03-10:
  - `src/adapters/registry.ts`
  - `src/adapters/process-runner.ts`

### The existing manifest examples already model the user journey Phase 4 should expose
The repository examples already encode the target `plan_done` approval fan-out to design and QA, followed by implementation after approved system design. Phase 4 can therefore demonstrate the real workflow shape without inventing a new scenario.

**Sources:**
- Local code inspection on 2026-03-10:
  - `agent-bus.example.yaml`
  - `agent-bus.yaml`

## Patterns to Follow
- Keep business rules in daemon and storage services, not in CLI command handlers.
- Prefer read-model composition over new mutable lifecycle state unless the requirement truly needs it.
- Support both concise human-readable output and `--json` for automation.
- Use deterministic temp-repository tests and fixture agents for operator workflow verification.

## Anti-Patterns to Avoid
- Direct SQLite access from CLI commands.
- Trusting stored `runs.status` alone as an operator truth when it is not lifecycle-complete.
- Making the demo or tests depend on authenticated external runtimes.
- Replacing the shipped real-runtime manifests with test-only fixtures.

## Dependencies Identified
| Package | Version | Purpose |
|---------|---------|---------|
| Node.js stdlib (`fs`, `path`) | existing | Envelope loading, fixture agents, and demo artifacts |
| Existing TypeScript toolchain | existing | CLI/operator command modules and tests |

No new npm dependency is required for Phase 4.

## Risks
- **Output drift across commands:** inconsistent fields would make automation brittle. Mitigation: shared formatter helpers and `--json`.
- **Misleading run inspection:** stored run rows do not currently reflect lifecycle completion. Mitigation: derive operator summaries from current event and delivery state.
- **Demo drift from real workflows:** fixture-only demos can become detached from the main manifest shape. Mitigation: keep the demo on the same topics and artifact conventions as the shipped examples.

## Recommendations for Planning
1. Start with read-side query and daemon operator-service work so every later CLI command targets a stable boundary.
2. Separate read-only commands from mutating commands so approval and replay guardrails do not crowd the parser refactor.
3. Add `publish --envelope <file>` as a thin bootstrap command instead of a flag-heavy event builder.
4. Finish with a deterministic CLI-driven demo that proves publish, approval, failure inspection, replay, and artifact completion.
