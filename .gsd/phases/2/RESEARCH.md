# Phase 2 Research

> **Phase**: 2 - Orchestration Core
> **Date**: 2026-03-09
> **Status**: Complete

## Scope
Phase 2 must turn the current foundation into a real orchestration core that supports:
- Durable fan-out to subscribers
- Human approval gates
- At-least-once delivery
- Retry scheduling and dead-letter handling
- Replay without direct database edits
- Delivery idempotency

## Current State

### What Phase 1 already provides
- Repository-local manifest parsing and validation
- Event envelope and artifact reference contracts
- SQLite-backed persistence and migrations
- A local daemon bootstrap path
- A recovery scan skeleton

### Architectural gaps carried out of Phase 1
- The manifest declares workspace directories, but runtime layout still uses hardcoded repository defaults.
- `deliveries` exists in schema, but publish flow does not create or consume durable delivery rows yet.
- Dispatcher state is in-memory only, so non-approved work is not recoverable from persistent scheduling state.
- Approval rows exist, but there is no approve/reject transition service.
- Replay, retry scheduling, DLQ transitions, and delivery claiming do not exist yet.

## Decisions

### 1. Manifest workspace settings must become authoritative
The runtime should resolve workspace, logs, and state paths from the manifest rather than hardcoded defaults. Phase 2 is the right time to fix this because approval, replay, and adapter execution will all depend on the same path contract.

Implication:
- Runtime layout, artifact resolution, and DB path resolution should accept manifest-configured roots.

### 2. Delivery planning should happen at publish time
When an event is published, Agent Bus should immediately resolve all matching subscribers from the manifest and persist one durable delivery work item per subscriber.

Why:
- Fan-out becomes crash-safe.
- Approval-gated events can snapshot subscriber intent before human review.
- Replay can target known deliveries instead of recalculating mutable subscriptions later.

Implication:
- Approval-gated events should create deliveries in a blocked or awaiting-approval state.
- Non-gated events should create deliveries in a ready-to-claim state.

### 3. At-least-once delivery should use lease-based claiming
Delivery workers will eventually need a durable way to claim work, process it, and either acknowledge success or schedule retry.

Chosen model:
- `pending/ready` delivery rows become claimable
- claim assigns lease owner/token and lease expiry
- success marks terminal completion
- failure either schedules retry or moves to dead-letter
- recovery scan reclaims expired leases

Why:
- This fits SQLite and a single daemon well.
- It preserves at-least-once semantics without requiring external queues.

### 4. Retry and dead-letter should live on the delivery state machine
Retries belong to deliveries, not events. A single event may fan out to multiple subscribers, and each subscriber can succeed or fail independently.

Implication:
- Delivery rows need scheduling fields such as status, next-attempt time, lease metadata, attempt counts, and dead-letter metadata.
- Retry policy should be deterministic and testable.

### 5. Replay should operate on durable delivery records, not raw event mutation
Replay must not require direct SQL edits, and it should preserve auditability.

Chosen direction:
- Replay should target persisted deliveries or events through application services.
- Replay should re-queue delivery work in a controlled way and preserve enough provenance to explain why work was retried or replayed.

Tradeoff:
- Re-queuing in place is simpler.
- Cloning or recording replay provenance is cleaner for auditability.

For V1 planning, keep the service contract explicit and allow implementation to choose the lightest design that preserves traceability.

### 6. Idempotency has two layers
- **Publish idempotency:** prevent duplicate event ingestion through event `dedupeKey`
- **Delivery idempotency:** prevent duplicate delivery planning or unbounded duplicate processing for the same target work item

Implication:
- Delivery store APIs must make duplicate planning detectable.
- Claim/ack/fail APIs should center around a durable delivery identity rather than ephemeral in-memory notifications.

## Recommended Phase 2 Shape

### Plan 2.1
Align runtime configuration with the manifest and introduce a durable delivery/approval repository model.

### Plan 2.2
Publish path plans durable fan-out work and approval transitions unlock or cancel that work.

### Plan 2.3
Delivery claiming, lease expiry, retry scheduling, DLQ transitions, and duplicate-suppression rules.

### Plan 2.4
Replay services and end-to-end orchestration verification over the full state machine.

## Tradeoffs to Keep Visible
- `node:sqlite` remains behind `--experimental-sqlite` on the current Node runtime, so storage remains intentionally abstracted.
- Full operator CLI should stay mostly out of Phase 2; Phase 4 owns the broad user-facing CLI surface.
- Runtime adapters should not be pulled forward into this phase; this phase ends at orchestration primitives.
