# ROADMAP.md

> **Current Phase**: Phase 2 - Orchestration Core
> **Milestone**: v1.0

## Must-Haves (from SPEC)
- [ ] Repository-local workflow manifest
- [ ] Durable event store with approval, retry, dead-letter handling, and replay
- [ ] Shared workspace artifact handoff by relative path
- [ ] Runtime adapter contract for Antigravity, Open Code, and Codex
- [ ] CLI operations for run inspection and approval workflow

## Phases

### Phase 1: Foundation
**Status**: ✅ Complete
**Objective**: Define the manifest, event schema, shared workspace conventions, SQLite-backed persistence layer, and local daemon skeleton.
**Requirements**: REQ-01, REQ-02, REQ-05, REQ-12

### Phase 2: Orchestration Core
**Status**: ⬜ Not Started
**Objective**: Implement fan-out delivery, human approval gates, retry handling, dead-letter queue behavior, replay, and idempotency controls.
**Requirements**: REQ-03, REQ-04, REQ-06, REQ-07, REQ-08, REQ-09

### Phase 3: Runtime Adapters
**Status**: ⬜ Not Started
**Objective**: Establish the adapter contract and deliver working Antigravity, Open Code, and Codex integrations against the shared workspace model.
**Requirements**: REQ-10, REQ-12

### Phase 4: Operator Workflow
**Status**: ⬜ Not Started
**Objective**: Build the CLI surface for run visibility, approvals, rejection feedback, failure inspection, replay, and an end-to-end demo workflow.
**Requirements**: REQ-11, REQ-03, REQ-04, REQ-08
