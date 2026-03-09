# REQUIREMENTS.md

## Format
| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| REQ-01 | The system shall load a repository-local workflow manifest that defines agents, subscriptions, approval gates, commands, and artifact conventions. | SPEC goal 3 | Pending |
| REQ-02 | The system shall allow publishers to emit events with a typed topic, metadata, and relative artifact paths instead of inline artifact content. | SPEC goal 3 | Pending |
| REQ-03 | The system shall match published events to one or more subscribers based on manifest-defined subscriptions and fan out deliveries asynchronously. | SPEC goal 1 | Pending |
| REQ-04 | The system shall place configured events into a pending approval state and deliver them only after an explicit human approval action. | SPEC goal 2 | Pending |
| REQ-05 | The system shall persist events, deliveries, approval state, and run metadata in a local durable store that survives restarts. | SPEC goal 2 | Pending |
| REQ-06 | The system shall provide at-least-once delivery with configurable retry policy for subscriber jobs. | SPEC goal 2 | Pending |
| REQ-07 | The system shall move exhausted deliveries to a dead-letter queue and expose them for inspection and replay. | SPEC goal 2 | Pending |
| REQ-08 | The system shall support replay of historical events or failed deliveries without manual database edits. | SPEC goal 2 | Pending |
| REQ-09 | The system shall enforce idempotent delivery handling through dedupe keys and delivery tracking so duplicate processing can be detected or suppressed. | SPEC goal 2 | Pending |
| REQ-10 | The system shall expose a runtime adapter contract that lets Antigravity, Open Code, and Codex workers receive event context, read artifact files, write output artifacts, and emit follow-up events. | SPEC goal 1 | Pending |
| REQ-11 | The system shall provide CLI commands to inspect runs, list pending approvals, approve or reject events, inspect failures, and trigger replay. | SPEC goal 3 | Pending |
| REQ-12 | The system shall operate in a one-machine, one-repository model with a shared workspace and without requiring distributed infrastructure. | SPEC goal 1 | Pending |
