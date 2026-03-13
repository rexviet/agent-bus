# ROADMAP.md

> **Current Phase**: Milestone Planning
> **Milestone**: v1.1
> **Goal**: Separate workflow semantics from storage and dispatch implementation details so future backends can be added without breaking the stable SQLite local-first workflow.

## Milestone Context
- [x] `v1.0` is complete and remains the stable baseline.
- [ ] `v1.1` will extract backend contracts and preserve current behavior on SQLite.
- [ ] Distributed server, API, MCP, or Kafka-backed execution is explicitly deferred beyond this milestone.

## Must-Haves
- [ ] Define backend contracts for runs, events, approvals, deliveries, replay, and operator read models.
- [ ] Refactor the current SQLite-backed implementation behind those contracts without changing manifest, envelope, or CLI behavior.
- [ ] Separate dispatch and worker lifecycle logic from backend-specific persistence details.
- [ ] Add backend-neutral conformance coverage so future implementations can prove the same workflow semantics.
- [ ] Document the extension path for future API, MCP, or broker-backed control planes.

## Nice-To-Haves
- [ ] Add a lightweight in-memory or fake backend for faster tests.
- [ ] Add explicit backend selection in runtime startup or config.
- [ ] Capture a concrete design spike for a future Node control plane plus external broker backend.

## Phases

### Phase 1: Backend Contracts
**Status**: ⬜ Not Started
**Objective**: Define the domain-owned interfaces and invariants for workflow state, routing, approval transitions, replay, and operator reads before any implementation refactor begins.
**Requirements**: REQ-05, REQ-06, REQ-07, REQ-08, REQ-11, REQ-12

### Phase 2: SQLite Backend Extraction
**Status**: ⬜ Not Started
**Objective**: Move the existing SQLite repositories and daemon orchestration logic behind the new contracts while preserving all current V1 behavior and operator workflows.
**Requirements**: REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-11, REQ-12

### Phase 3: Dispatch and Worker Boundary
**Status**: ⬜ Not Started
**Objective**: Isolate claim, lease, retry, dead-letter, and worker-execution coordination from the local storage implementation so alternate dispatch backends can plug in cleanly.
**Requirements**: REQ-03, REQ-04, REQ-06, REQ-07, REQ-08, REQ-10, REQ-12

### Phase 4: Conformance and Compatibility
**Status**: ⬜ Not Started
**Objective**: Build backend-neutral verification coverage that proves the same publish, approval, replay, failure, and operator semantics remain intact across implementations.
**Requirements**: REQ-03, REQ-04, REQ-08, REQ-11, REQ-12

### Phase 5: Extension Blueprint
**Status**: ⬜ Not Started
**Objective**: Document how future API, MCP, server, or broker-backed backends can fit the extracted contracts without redefining the manifest or event protocol.
**Requirements**: REQ-01, REQ-11, REQ-12
