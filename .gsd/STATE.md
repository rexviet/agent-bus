# STATE.md

> **Current Phase**: Milestone Planning
> **Current Focus**: Drafting `v1.1` to extract backend abstraction boundaries while keeping the SQLite local-first runtime as the stable default
> **Last Updated**: 2026-03-13

## Current Position
- **Milestone**: v1.1
- **Phase**: Not started
- **Task**: Milestone drafted; Phase 1 planning pending
- **Status**: Milestone planned (drafted 2026-03-10 17:12 +07)

## Active Work
- `v1.0` remains complete and is the baseline behavior to preserve.
- `v1.1` is drafted as an architecture milestone for backend abstraction, not a distributed-backend implementation milestone.
- The current branch `feature/gemini-runtime-adapter` replaces the unstable Antigravity runtime path with Gemini CLI while keeping the local SQLite workflow and operator demo intact.

## Last Session Summary
The repository finished `v1.0` with operator workflow and README work already merged on `main`. This session starts the next milestone definition, focused on separating workflow semantics from storage and dispatch implementation details so future backends can be added without destabilizing the current SQLite runtime.

## In-Progress Work
No `v1.1` implementation has started yet.
- Branch: `feature/gemini-runtime-adapter`
- Milestone status: drafted only
- Runtime status: built-in QA runtime support now targets Gemini CLI instead of Antigravity for local v1 testing stability
- Tests status: current verification is `npm test` with `66/66` passing tests plus manifest validation for `agent-bus.example.yaml`, `agent-bus.yaml`, and `examples/operator-demo/agent-bus.demo.yaml`
- Local workspace note: additional docs-only demo prompt files exist under `examples/operator-demo/agents-demo/`

## Blockers
No active implementation blocker.

## Context Dump
Critical context that would be lost:

### Decisions Made
- `v1.1` is about abstraction boundaries, not shipping a Node server, API layer, MCP surface, or Kafka-backed runtime yet.
- SQLite and the local daemon remain required working defaults throughout this milestone.
- The manifest, envelope schema, CLI semantics, operator demo, and repository-local artifact model must remain stable while the internals are refactored.

### Approaches Tried
- Grounded the milestone in the existing SPEC constraints for one-machine, one-repository, local-first execution.
- Derived the milestone phases from the architecture discussion: backend contracts first, then SQLite extraction, then dispatch isolation, then conformance coverage, then future-backend documentation.

### Current Hypothesis
The safest path to future multi-backend support is to separate domain workflow semantics from backend mechanics before introducing any distributed control plane. If the contracts and conformance suite are solid, a later server or broker backend can be added without redesigning the protocol.

### Files of Interest
- `.gsd/SPEC.md`: current product constraints and non-goals
- `.gsd/ROADMAP.md`: drafted `v1.1` milestone and phase breakdown
- `src/daemon/`: orchestration, approval, replay, dispatch, and worker logic that currently mixes domain and backend concerns
- `src/storage/`: SQLite-specific repositories that will need contract extraction
- `src/cli/`: operator surface that must remain compatible throughout the refactor

## Next Steps
1. Review and refine the drafted `v1.1` scope and phase order.
2. Run `/plan 1` to research and break down Phase 1 backend contracts.
3. Start `v1.1` implementation on a fresh branch once the milestone draft is accepted.

## Notes
- Project initialized through `/new-project`.
- The repository baseline remains Node `22.12.0+`; run `nvm use v22.12.0` before any `npm` command.
- `v1.0` remains the reference behavior; do not regress the deterministic operator demo or the current CLI workflow while extracting abstractions.
- Future backends should preserve the repository-authored manifest and event-envelope contract rather than redefining the workflow model.
