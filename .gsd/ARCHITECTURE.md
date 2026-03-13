# ARCHITECTURE.md

> Mapped on: 2026-03-13
> Baseline: current `v1.0` implementation, with `v1.1` extraction pressure points called out explicitly

## System Summary

`agent-bus` is a local-first orchestration runtime for multi-agent software workflows inside a single repository. The repository-authored manifest defines agents, topic subscriptions, approval-gated topics, and workspace roots. The runtime persists workflow state in SQLite, passes artifacts by repository-relative file paths, and executes agents as local subprocesses through a JSON work-package contract.

The implementation is intentionally narrow:

- one repository
- one machine
- one SQLite database
- CLI-first operations
- no HTTP API, broker, or multi-node coordination

## Repository Shape

| Path | Role |
| --- | --- |
| `src/cli.ts` | Primary CLI entry point and top-level command router |
| `src/cli/` | Operator commands, worker loop command, envelope loading, text output formatting |
| `src/config/` | YAML manifest loading, schema validation, relationship validation |
| `src/domain/` | Event-envelope and artifact-path validation rules |
| `src/daemon/` | Runtime composition, publish/fan-out, approvals, replay, recovery, worker coordination |
| `src/storage/` | SQLite client, SQL migrations, repository-style stores for runs/events/deliveries/approvals |
| `src/adapters/` | Adapter contract, runtime registry, process spawning, vendor-specific command shaping |
| `src/shared/` | Repository-relative path and runtime-layout helpers |
| `test/` | Unit, integration, and end-to-end coverage across stores, daemon, CLI, and adapter flows |
| `examples/operator-demo/` | Deterministic demo manifest, envelopes, workspace artifacts, and reset script |
| `bin/agent-bus` | Shell bootstrap that enforces Node `>=22.12.0` and runs `dist/cli.js` with `--experimental-sqlite` |

## Entry Points

### CLI

`src/cli.ts` exposes the full user-facing surface:

- `layout`
- `validate-manifest`
- `daemon`
- `worker`
- `runs`
- `approvals`
- `failures`
- `replay`
- `publish`

The CLI is thin. It delegates most behavior to `startDaemon()` plus subcommand helpers in `src/cli/operator-command.ts` and `src/cli/worker-command.ts`.

### Programmatic Composition Root

`src/daemon/index.ts` is the real runtime assembly point. It:

1. loads the manifest
2. resolves and creates runtime directories
3. opens SQLite in WAL mode
4. runs migrations
5. constructs concrete stores
6. wires approval, delivery, replay, operator, and worker services
7. optionally starts recovery scanning

Architecturally, the "daemon" is an in-process facade rather than a separately modeled control plane. Operator commands create it transiently for each invocation. The worker command keeps it alive inside the polling loop.

## Core Runtime Flow

### 1. Manifest and Layout Resolution

`src/config/load-manifest.ts` parses YAML with `yaml` and validates it with `zod`. It also checks cross-record relationships such as:

- no duplicate agent IDs
- no duplicate `agentId/topic` subscriptions
- no subscriptions targeting unknown agents
- no duplicate approval-gate topics

`src/shared/runtime-layout.ts` resolves manifest-relative directories into:

- workspace directory
- state directory
- logs directory
- derived internal directory

All workspace paths are forced to stay inside the repository root.

### 2. Publish and Fan-Out

The publish path starts in `src/cli/operator-command.ts` and reaches `src/daemon/publish-event.ts`.

`publishEvent()` does the following inside the SQLite-backed persistence layer:

1. creates a run if `runId` is new
2. determines whether the topic is approval-gated
3. persists the event
4. persists event artifact references
5. creates a pending approval row when required
6. plans one delivery per subscribed agent
7. emits dispatcher notifications for pending approvals or ready deliveries

Routing is topic-based through `src/daemon/subscription-planner.ts`. Fan-out is deterministic and deduplicated per `eventId + agentId`.

### 3. Approval Flow

Approvals are handled through `src/daemon/approval-service.ts`.

Approve path:

1. mark approval row as `approved`
2. update the event approval status to `approved`
3. transition event deliveries from `pending_approval` to `ready`
4. touch the run
5. emit ready-delivery notifications

Reject path:

1. mark approval row as `rejected`
2. update the event approval status to `rejected`
3. transition event deliveries from `pending_approval` to `cancelled`
4. touch the run

Both transitions run transactionally.

### 4. Worker Execution Path

`src/cli/worker-command.ts` runs the local polling loop. Each iteration calls `runWorkerIteration()` from `src/daemon/adapter-worker.ts`.

Worker flow:

1. claim the next `ready` or `retry_scheduled` delivery
2. load the source event and manifest agent record
3. verify subscription-required artifacts exist on the event
4. build a normalized adapter work package
5. materialize an adapter-run directory under state plus a log file under logs
6. build a subprocess command using vendor-specific logic or generic fallback
7. spawn the child process
8. read the result envelope from disk
9. transition the delivery to `completed`, `retry_scheduled`, or `dead_letter`
10. on success, publish follow-up events transactionally before acknowledging the delivery

The work package is file-based by design. Agents never talk to SQLite directly.

### 5. Retry, Dead-Letter, Recovery, and Replay

Retry and dead-letter behavior lives in `src/storage/delivery-store.ts` plus `src/daemon/delivery-service.ts`.

- retryable adapter result: schedules a future `available_at`
- fatal adapter result: dead-letters immediately
- process/setup failure: either retries or dead-letters depending on failure mode and attempt count
- expired lease: reclaimed back to `ready` by recovery scan, or dead-lettered if appropriate

`src/daemon/recovery-scan.ts` periodically:

- reclaims expired leases
- re-emits pending approvals
- re-emits ready deliveries

`src/daemon/replay-service.ts` supports replay of:

- individual replayable deliveries
- all deliveries for a replayable event

Replayable delivery states are currently `completed`, `dead_letter`, `retry_scheduled`, and `ready`.

## Durable State Model

SQLite is the only durable backend in the current implementation.

### Tables

| Table | Purpose |
| --- | --- |
| `schema_migrations` | Tracks applied SQL migrations |
| `runs` | Top-level workflow instance metadata |
| `events` | Immutable published envelopes plus approval status and producer metadata |
| `event_artifacts` | Artifact references attached to each event |
| `deliveries` | One row per event/subscriber target with lease, retry, and replay metadata |
| `approvals` | Manual approval work and decisions |

### Important Invariants

- `events.dedupe_key` is unique
- `deliveries(event_id, agent_id)` is unique
- foreign keys are enabled
- journal mode is WAL
- artifact paths must remain repository-relative
- work-package result and log paths must stay inside state/log directories

### File-System Side Effects

Runtime state is split between SQLite and repository-local files:

- workspace artifacts under the manifest-configured workspace root
- adapter-run work packages and result envelopes under `stateDir/adapter-runs/`
- adapter stdout/stderr logs under `logsDir/adapter-runs/`

This means the filesystem is part of the runtime contract, not just an implementation detail.

## Adapter Boundary

The adapter contract in `src/adapters/contract.ts` is the current runtime boundary between orchestration and an agent process.

Inputs:

- agent metadata
- delivery context
- event context
- required artifacts
- resolved artifact input absolute paths
- workspace/result/log paths

Outputs:

- `success`
- `retryable_error`
- `fatal_error`
- optional emitted follow-up events
- output artifact references

Built-in command shaping exists for:

- `codex`
- `open-code`
- `gemini`

All other runtime identities fall back to the manifest-declared command unchanged.

## Operator Read Model

Operator views are assembled in `src/daemon/operator-service.ts` from multiple stores.

Exposed read models:

- run summaries
- run detail
- pending approval views
- failure-delivery views

Important detail: the operator-facing run status is derived from deliveries and approvals at read time. It is not the same thing as the persisted `runs.status` field.

## Test Coverage Snapshot

The repository currently has:

- 25 test files
- 66 `node:test` test cases

Coverage focuses on:

- manifest and schema validation
- artifact-path normalization
- store behavior and migration-backed persistence
- publish/fan-out semantics
- approvals, retry, dead-letter, replay, and recovery
- worker execution and adapter contract handling
- CLI operator flows
- end-to-end demo workflow behavior

## Current Architecture Pressure Points

These are the most relevant findings for planned `v1.1` backend extraction work.

### 1. Backend boundaries are not extracted yet

`startDaemon()` wires concrete SQLite stores directly into services. Cross-module typing uses `ReturnType<typeof create...Store>` aliases instead of backend-neutral interfaces. The code is modular, but not yet contract-driven.

### 2. Dispatch is still storage-shaped

The `dispatcher` only records deduplicated notifications for approvals and ready deliveries. It is not a pluggable queue, scheduler, or delivery backend. Lease ownership, retry timing, and replay semantics remain SQLite-store concerns.

### 3. Manifest behavior runs ahead of implementation in a few places

The manifest schema validates more than the runtime currently enforces:

- `approvalGates[].approvers` is parsed but not checked when approvals are executed
- `approvalGates[].onReject` is parsed but not applied; rejection always cancels downstream deliveries
- `artifactConventions` is validated and documented but not consumed by the runtime

This is the clearest doc/schema/runtime drift in the codebase.

### 4. Run lifecycle is split between persisted and derived state

`runs.status` exists in the schema, but the runtime never drives it through `completed`, `failed`, or `cancelled`. Operator status is derived from current deliveries and approvals instead. That makes the read model useful, but the domain model incomplete.

### 5. Runtime-family semantics are slightly mixed

The registry treats `codex`, `open-code`, and `gemini` as first-class runtime families. The example manifests and several tests also use `claude-code`, but that identity goes through the generic fallback path rather than the supported-runtime registry. That is workable, but it should be made explicit in future backend and adapter contracts.

### 6. "Daemon" currently means a local composition root more than a resident service

The current control flow is centered on:

- transient daemon instances for operator commands
- a long-lived worker polling loop for actual execution
- recovery scanning as an in-process timer

That is fine for local-first V1, but it is the exact boundary that `v1.1` will need to formalize before alternate backends can exist cleanly.
