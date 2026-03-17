# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript + copy migrations to dist/
npm run typecheck    # Type-check without emitting
npm test             # Build then run tests (requires Node 22.12+)
npm run start        # Run the CLI (after build)
npm run daemon       # Start the daemon service
npm run link:global  # Build and install `agent-bus` binary globally
```

Run a single test file:
```bash
node --experimental-sqlite --test dist/test/path/to/file.test.js
```

> **Node.js 22.12+ is required.** The runtime uses the built-in `node:sqlite` module (experimental). The `bin/agent-bus` wrapper automatically loads nvm if needed.

## Architecture

Agent Bus is a **local-first, event-driven orchestration runtime** for multi-agent workflows. Agents communicate via durable events (SQLite) rather than direct calls.

### Core Flow

```
publish event → fan-out to subscribers → [approval gate?] → worker claims delivery
→ work package materialized as JSON → adapter spawns agent process → agent writes result
→ ack/retry/dead-letter + emit follow-up events
```

### Key Layers

**`src/domain/`** — Core types: `EventEnvelope` (immutable facts) and `ArtifactRef` (file references passed between agents).

**`src/storage/`** — SQLite persistence with WAL mode. Four stores: `EventStore`, `DeliveryStore`, `ApprovalStore`, `RunStore`. Migrations in `src/storage/migrations/` are copied to `dist/` during build.

**`src/daemon/`** — Runtime orchestration:
- `publish-event.ts` — persists event and fans out to matching subscribers
- `subscription-planner.ts` — matches events to agent subscriptions
- `delivery-service.ts` — lease-based claiming (worker holds time-bounded lease)
- `adapter-worker.ts` — creates work packages, spawns agent processes, processes results
- `approval-service.ts` — manual approval gates before delivery becomes `ready`
- `recovery-scan.ts` — detects stale leases and moves deliveries to retry

**`src/adapters/`** — Runtime family registry for spawning agents:
- `registry.ts` — maps runtime family names to command builders
- `vendors/` — codex, gemini (headless `-p` flag), open-code adapters

**`src/config/`** — YAML manifest loading and Zod validation. `agent-bus.yaml` is the default manifest path.

**`src/cli/`** — CLI command handlers for operator inspection: runs, approvals, failures, replay, publish.

### Delivery State Machine

```
pending_approval → ready → leased → completed
                                  ↘ retry_scheduled → ready
                                  ↘ dead_letter
```

### Work Package Contract

Agents receive env vars pointing to JSON files:
- `AGENT_BUS_WORK_PACKAGE_PATH` — input (event envelope + subscription context)
- `AGENT_BUS_RESULT_FILE_PATH` — agent writes result here
- `AGENT_BUS_LOG_FILE_PATH` — agent log output

Result must match one of: `success`, `retryable_error`, `fatal_error` (schemas in `src/adapters/contract.ts`).

### Manifest Structure

`agent-bus.yaml` defines agents, subscriptions, approval gates, artifact conventions, and workspace paths (`stateDir` for SQLite, `artifactsDir`, `logsDir`).

## Development Methodology (GSD)

This project uses the **GSD (Get Shit Done)** methodology defined in `PROJECT_RULES.md`:

- Planning/execution model is documented in [`.planning/README.md`](/Users/macbook/Data/Projects/agent-bus/.planning/README.md)
- **PLAN/RESEARCH in `.planning/` → SYNC → EXECUTE/VERIFY in `.gsd/` → HANDOFF back to `.planning/`**
- Every change requires empirical proof (command output, test result) — never "it looks correct"
- One task = one commit; format: `type(scope): description`
- `.planning/STATE.md` is canonical; `.gsd/JOURNAL.md` captures execution-local notes
- Search first, targeted reads — avoid loading full files unnecessarily

Commit types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Agent Bus application
Your role and task instructions are defined in: .agent/identities/planner.md