# STACK.md

> Mapped on: 2026-03-13

## Core Environment

| Item | Version / State | Notes |
| --- | --- | --- |
| Package name | `agent-bus` `0.1.0` | Private package |
| Node.js | `>=22.12.0` | Required by `package.json`, `.nvmrc`, and `bin/agent-bus` |
| Module system | ESM | `"type": "module"` |
| Language | TypeScript | Source in `src/`, compiled to `dist/` |
| SQLite access | `node:sqlite` | Requires `--experimental-sqlite` at runtime |

## Installed Dependencies

### Production Dependencies

| Package | Installed | Declared | Purpose |
| --- | --- | --- | --- |
| `yaml` | `2.8.2` | `^2.8.2` | Parses manifest files |
| `zod` | `4.3.6` | `^4.3.6` | Validates manifests, envelopes, artifact refs, and adapter contracts |

### Development Dependencies

| Package | Installed | Declared | Purpose |
| --- | --- | --- | --- |
| `typescript` | `5.9.3` | `^5.9.3` | Compilation and type-checking |
| `@types/node` | `22.19.15` | `^22.15.30` | Node type definitions |

## Node Built-Ins in Active Use

The runtime intentionally leans on platform APIs rather than a larger library stack.

| Built-in | Used For |
| --- | --- |
| `node:sqlite` | Durable workflow state |
| `node:fs/promises` and `node:fs` | Manifest loading, migration loading, adapter work-package materialization, logs |
| `node:path` and `node:url` | Repository-relative path safety and runtime layout |
| `node:child_process` | Spawning agent runtimes |
| `node:crypto` | UUID generation for events and lease tokens |
| `node:events` | Waiting for log-stream close |
| `node:test` and `node:assert/strict` | Test runner and assertions |

## Build, Test, and Packaging

| Script | Command | Notes |
| --- | --- | --- |
| `build` | `tsc -p tsconfig.json` plus migration copy step | Compiles to `dist/` and copies SQL migrations into runtime output paths |
| `typecheck` | `tsc --noEmit -p tsconfig.json` | Static type check only |
| `test` | `npm run build && node --experimental-sqlite --test dist/test/**/*.test.js` | Tests compiled output, not raw TS |
| `start` | `node --experimental-sqlite dist/cli.js` | CLI entry after build |
| `daemon` | `node --experimental-sqlite dist/cli.js daemon` | Local runtime initialization path |
| `link:global` | `npm run build && npm link` | Global CLI install from source |
| `unlink:global` | `npm unlink -g agent-bus` | Removes global link |

Packaging details:

- `bin/agent-bus` is a Bash wrapper
- it enforces Node `>=22.12.0`
- it prefers the current `node` if compatible
- otherwise it tries `nvm use`
- it runs the compiled CLI with `--experimental-sqlite`

## Storage and State Stack

| Concern | Technology | Notes |
| --- | --- | --- |
| Durable state | SQLite | Single-file local database |
| DB access style | Direct SQL via `DatabaseSync` | No ORM or query builder |
| Migrations | Raw SQL files | `001_initial.sql`, `002_orchestration_core.sql` |
| Journal mode | WAL | Set in `openSqliteDatabase()` |
| FK enforcement | SQLite foreign keys | Enabled on open |
| Busy timeout | `5000ms` | Set on database open |
| Artifact storage | Repository filesystem | Relative artifact refs resolved into workspace dir |
| Logs | Repository filesystem | Adapter stdout/stderr written to log files |

Default runtime layout:

- artifacts: `workspace/`
- state: `.agent-bus/state/`
- logs: `.agent-bus/logs/`

The manifest can override all three, but they must stay inside the repository root.

## Runtime Adapter Stack

| Runtime identity | Handling mode | Notes |
| --- | --- | --- |
| `codex` | Vendor-specific command builder | Ensures `exec` form and result sidecar path |
| `open-code` | Vendor-specific command builder | Uses `run --dir --file --format json` shape |
| `gemini` | Vendor-specific command builder | Uses `-p` headless mode with default `--approval-mode auto_edit` and an attached work-package prompt |
| anything else | Generic manifest-command fallback | Used today for identities such as `claude-code` in examples/tests |

Common adapter environment variables:

- `AGENT_BUS_SCHEMA_VERSION`
- `AGENT_BUS_AGENT_ID`
- `AGENT_BUS_RUNTIME`
- `AGENT_BUS_WORK_PACKAGE_PATH`
- `AGENT_BUS_RESULT_FILE_PATH`
- `AGENT_BUS_LOG_FILE_PATH`

## CLI / Operational Surface

Current user-facing operations are all CLI-driven:

- manifest validation
- layout inspection
- event publish
- run inspection
- pending approval inspection and mutation
- failure inspection
- event/delivery replay
- worker polling

There is no web UI, HTTP API, MCP server, or background job system in the current stack.

## Testing Stack

| Area | Tooling |
| --- | --- |
| Test runner | `node:test` |
| Assertions | `node:assert/strict` |
| Process integration | `child_process` helpers plus fixture scripts |
| Temporary repos | `fs/promises` + OS temp directories |
| Fixture agents | `test/fixtures/agents/*.mjs` |
| Fixture adapters | `test/fixtures/adapters/*.mjs` |

Current test inventory:

- 25 test files
- 66 test cases

Notable coverage areas:

- manifest validation
- adapter contract parsing
- SQLite stores
- publish/fan-out
- approvals
- retry/dead-letter/replay
- worker execution
- operator CLI flows
- deterministic operator demo

## What Is Not in the Stack

These absences matter because they define the current architecture as much as the included tools do.

- no framework such as Express, Fastify, Nest, React, or Next.js
- no ORM such as Prisma, Drizzle, or TypeORM
- no message broker such as Kafka, NATS, or RabbitMQ
- no lint or formatting tool configured in `package.json`
- no container/orchestration config in the repository root
- no hosted service dependencies in runtime code

## Package Freshness Snapshot

`npm outdated` on 2026-03-13 only reported one package behind latest major:

| Package | Current | Wanted | Latest | Interpretation |
| --- | --- | --- | --- | --- |
| `@types/node` | `22.19.15` | `22.19.15` | `25.5.0` | Current install matches the Node 22 target; drift is only relative to a newer major line |

No production dependency drift showed up in that check.

## Stack Implications for `v1.1`

The current stack is deliberately minimal, but that also explains the next refactor target:

- backend concerns are embedded directly in SQLite-backed stores and daemon assembly
- queueing semantics are implemented with SQL rows and in-process timers
- adapter execution is subprocess-based and filesystem-coupled
- conformance behavior is tested against the concrete SQLite implementation, not an abstract backend contract

That makes the codebase a good candidate for backend extraction work without changing the public CLI, manifest, or envelope formats.
