# SPEC.md — Project Specification

> **Status**: `FINALIZED`

## Vision
Agent Bus is a local-first event-driven orchestration runtime for solo vibe coders building software with multiple AI agent runtimes. It replaces manual, synchronous handoffs between planning, design, QA, and coding agents with a durable event bus, human approval gates, and file-based artifact passing inside a single repository workspace.

## Goals
1. Enable asynchronous, event-driven coordination between multiple agent runtimes inside one repository on one machine.
2. Provide durable orchestration primitives for software-delivery workflows, including publish/subscribe, approval gates, retry, dead-letter handling, replay, and idempotent processing.
3. Make agent handoffs explicit and inspectable through file-based artifacts, workflow manifests, and CLI-based operational visibility.

## Non-Goals (Out of Scope)
- Multi-machine or distributed orchestration in V1
- Hosted SaaS, multi-tenant control plane, or RBAC/auth systems
- Rich web dashboard in V1
- Generic task orchestration beyond software-delivery-first workflows
- Autonomous workflow generation without an explicit workflow manifest

## Users
Solo vibe coders coordinating multiple AI runtimes such as Antigravity, Open Code, and Codex in a single repository. They work locally, keep artifacts in a shared workspace, review critical outputs before downstream execution, and need reliable fan-out between specialized agents.

## Constraints
- V1 runs on one machine against one repository with a shared filesystem workspace.
- Artifacts are passed by relative file paths in event payloads instead of inline content.
- Workflow behavior is declared in a manifest stored in the repository.
- Selected events must wait for human approval before delivery to subscribers.
- V1 must support real runtime adapters for Antigravity, Open Code, and Codex.
- SQLite is the durable event store, while a local daemon handles dispatch and recovery.
- GUI automation is not assumed; adapters should prefer stable CLI or wrapper-based invocation.

## Success Criteria
- [ ] A user can run a real workflow in one repository where `plan_done` enters approval, approval fans out to both design and QA subscribers, and downstream artifacts are written into the shared workspace.
- [ ] The system delivers runtime adapter jobs with at-least-once semantics, retry, dead-letter handling, replay, and idempotent subscriber processing.
- [ ] A user can configure the workflow entirely through a manifest and operate the system through CLI commands to inspect runs, approve or reject pending events, and replay failed deliveries.
- [ ] Antigravity, Open Code, and Codex can participate in the same end-to-end workflow through the shared adapter contract.
