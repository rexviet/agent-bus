# Agent Bus

`agent-bus` is a local-first, event-driven orchestration runtime for multi-agent work inside one repository.

It turns agent collaboration into durable workflow events stored in SQLite, with retry/replay, approval gates, and artifact-based handoff.

## New Highlights

### 1) `/sync-planning-to-gsd`

Project canonical planning docs from `.planning/` into execution workspace `.gsd/`.

What it enables:
- Planning stays canonical in `.planning/`
- Antigravity/Codex execution reads from `.gsd/`
- Synced files are fingerprint-stamped so later handoff can detect drift safely

Entry points:
- Workflow doc: [`.agent/workflows/sync-planning-to-gsd.md`](.agent/workflows/sync-planning-to-gsd.md)
- Script: [`scripts/sync-planning-to-gsd.mjs`](scripts/sync-planning-to-gsd.mjs)

Examples:

```bash
node scripts/sync-planning-to-gsd.mjs
node scripts/sync-planning-to-gsd.mjs --phase 6
node scripts/sync-planning-to-gsd.mjs --phase 6 --phases-only
node scripts/sync-planning-to-gsd.mjs --root-only
```

### 2) `/handoff-execution <phase-number>`

Bring verified execution results from `.gsd/` back to canonical `.planning/`.

What it enables:
- Execution updates become authoritative in planning docs
- Handoff refuses to overwrite if planning changed after last sync
- Execution-only hints are removed from canonical planning state

Entry points:
- Workflow doc: [`.agent/workflows/handoff-execution.md`](.agent/workflows/handoff-execution.md)
- Script: [`scripts/handoff-execution-to-planning.mjs`](scripts/handoff-execution-to-planning.mjs)
- Test: [`test/scripts/handoff-execution-to-planning.test.ts`](test/scripts/handoff-execution-to-planning.test.ts)

Example:

```bash
node scripts/handoff-execution-to-planning.mjs 6
```

## Canonical Planning Loop

Use this sequence for each execution wave:

1. Plan/research in `.planning/`
2. Sync projection into `.gsd/`:

```bash
node scripts/sync-planning-to-gsd.mjs --phase 6
```

3. Execute/verify from `.gsd/`
4. Handoff execution results back into canonical planning:

```bash
node scripts/handoff-execution-to-planning.mjs 6
```

5. Continue planning from updated `.planning/`

## Why Agent Bus Instead Of Sync Agent-to-Agent Calls?

| Concern | Direct Sync Calls | Agent Bus |
| --- | --- | --- |
| Failure handling | Caller owns retry logic | Retry, dead-letter, replay built in |
| Human gates | Ad hoc | Durable approval gates |
| Audit trail | Prompt/log scattered | Persisted events, deliveries, approvals |
| Artifact handoff | Usually inline text | Repository file references |
| Recovery | Fragile | Restart-safe SQLite state |
| Fan-out | Manual multi-call | Topic subscriptions |

If you only need small blocking request/response, direct sync can be simpler.
If you need durable workflow operations, Agent Bus is the safer default.

## Protocol Overview

Agent Bus revolves around three payloads:

1. Event envelope (producer publishes)
2. Adapter work package (bus materializes for target agent)
3. Adapter result envelope (agent writes execution outcome)

Contract reference: [`src/adapters/contract.ts`](src/adapters/contract.ts)

## Core Concepts

| Term | Meaning |
| --- | --- |
| Run | One end-to-end workflow instance |
| Event | Immutable fact published into bus |
| Delivery | One bus-assigned unit of work for one subscriber |
| Approval | Durable human gate for a topic |
| Artifact | Repository-relative file reference |
| Replay | Re-queue event/delivery without manual DB edits |

## Installation

### Prerequisites

- Node.js `22.12.0`+
- `nvm` recommended
- optional runtimes depending on manifest (`codex`, `open-code`, `gemini`, etc.)

### Install From Source

```bash
git clone <your-fork-or-repo-url>
cd agent-bus

source ~/.nvm/nvm.sh
nvm install 22.12.0
nvm use 22.12.0

npm install
npm run build
```

### Optional Global Link

```bash
npm run link:global
agent-bus --help
```

Unlink later:

```bash
npm run unlink:global
```

## Configuration

Manifest file is repository-local YAML, typically `agent-bus.yaml`.

Minimum shape:

```yaml
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: planner
    runtime: codex
    command: [codex, exec]

subscriptions:
  - agentId: planner
    topic: plan_done
```

Full schema reference: [`src/config/manifest-schema.ts`](src/config/manifest-schema.ts)

## CLI Usage

```text
agent-bus daemon [--config path] [--exit-after-ready]
agent-bus worker [--config path] [--worker-id id] [--lease-duration-ms N] [--poll-interval-ms N] [--retry-delay-ms N] [--once]
agent-bus layout [--config path] [--ensure]
agent-bus validate-manifest [path]
agent-bus runs <subcommand>
agent-bus approvals <subcommand>
agent-bus failures <subcommand>
agent-bus replay <target>
agent-bus publish --envelope <file>
```

Common commands:

```bash
node --experimental-sqlite dist/cli.js validate-manifest agent-bus.yaml
node --experimental-sqlite dist/cli.js layout --config agent-bus.yaml --ensure
node --experimental-sqlite dist/cli.js worker --config agent-bus.yaml --worker-id worker-1 --once
```

## Testing The New Handoff Guardrails

Run the focused test for sync/handoff behavior:

```bash
node --test test/scripts/handoff-execution-to-planning.test.ts
```

## Current Feature Set

- Repository-local workflow manifests
- Typed event envelopes
- Durable state in SQLite (runs/events/deliveries/approvals)
- At-least-once delivery with retry and dead-letter
- Replay for failed deliveries and historical events
- Runtime adapters for Codex, Open Code, Antigravity, and generic commands
- Operator CLI for inspect/approve/reject/replay/publish
- Local dashboard with SSE live updates (binds to `127.0.0.1` only)
- Dashboard security model (v1): localhost-only, no authentication; do not expose via port-forwarding/reverse proxy on shared environments
- Planning projection workflow: `.planning/` -> `.gsd/` (`/sync-planning-to-gsd`)
- Canonical handoff workflow: `.gsd/` -> `.planning/` (`/handoff-execution`)

## References

- [`agent-bus.yaml`](agent-bus.yaml)
- [`agent-bus.example.yaml`](agent-bus.example.yaml)
- [`docs/operator-workflow-demo.md`](docs/operator-workflow-demo.md)
- [`docs/model-selection-playbook.md`](docs/model-selection-playbook.md)
- [`src/domain/event-envelope.ts`](src/domain/event-envelope.ts)
- [`src/adapters/contract.ts`](src/adapters/contract.ts)
