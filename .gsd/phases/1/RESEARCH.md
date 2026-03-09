# Phase 1 Research

> **Phase**: 1 - Foundation
> **Date**: 2026-03-09
> **Status**: Complete

## Scope
Phase 1 needs foundation decisions for:
- Runtime and project bootstrap
- Manifest format and validation
- SQLite persistence baseline
- Shared workspace and internal state conventions
- Local daemon topology

## Findings

### 1. SQLite WAL fits the one-machine constraint
- SQLite WAL allows readers to continue while writes append to the WAL file, which matches a local daemon plus operator tooling well.
- WAL relies on shared memory for the WAL index, so it works best when all readers and writers are on the same machine and is not appropriate for a network filesystem.
- WAL mode persists once enabled, and SQLite auto-checkpoints by default when the WAL reaches a threshold size.

Implication:
- V1 should keep the one-machine, one-repo constraint.
- A single local daemon should own dispatch and writes, with operator reads sharing the same file-backed database.
- Foundation should enable WAL immediately and keep checkpoint tuning as a later operational concern.

### 2. Node.js already ships a synchronous SQLite API in v22
- Node.js v22 documents `node:sqlite` with `DatabaseSync`.
- The module was added in v22.5.0, which means it is available in the repository's pinned Node 22.12.0.
- The module is still marked `Stability: 1.1 - Active development`, and its APIs execute synchronously.

Implication:
- `node:sqlite` is usable for V1 and removes the need for a native third-party dependency.
- Because the API is still under active development, storage access should sit behind a thin local adapter so the project can swap implementations later if needed.
- A synchronous API is acceptable because Agent Bus already intends to centralize writes in one local daemon rather than expose the database directly to every runtime.

### 3. YAML is the right manifest format for a repo-authored workflow
- The `yaml` package supports YAML 1.1 and 1.2, preserves comments and blank lines, and has no external dependencies.
- The library is oriented toward both simple parse/stringify and deeper document-level manipulation.

Implication:
- A human-authored `agent-bus.yaml` manifest is a good fit for V1.
- The loader should parse YAML once at boot, validate it, and fail fast with clear diagnostics.
- Comment preservation is useful if the project later adds manifest rewrite or normalization commands.

### 4. Zod is a strong fit for manifest and event validation
- Zod is TypeScript-first, infers static types from schemas, and has zero external dependencies.
- The same schema can validate untrusted runtime input and provide compile-time types to the rest of the codebase.

Implication:
- Manifest parsing and event-envelope validation should use Zod as the source of truth.
- Phase 1 can define stable contracts early without duplicating interfaces and validators.

## Decisions

### Runtime and Tooling
- Use `TypeScript` on `Node.js 22`.
- Use repository-local scripts for `build`, `typecheck`, `test`, and daemon startup.
- Keep the runtime thin and standard-library-first.

### Manifest
- Use a repository-root manifest named `agent-bus.yaml`.
- Keep a committed example manifest `agent-bus.example.yaml` for smoke tests and onboarding.
- Validate the parsed manifest with Zod and reject invalid configs before daemon startup.

### Workspace and State Layout
- Use `workspace/` for human-visible artifacts that agents hand off by relative path.
- Use `.agent-bus/state/` for SQLite and runtime metadata.
- Use `.agent-bus/logs/` for daemon logs or future operational traces.

### Persistence
- Start with `node:sqlite` and enable WAL on the database file.
- Keep migration SQL as plain `.sql` files in the repository.
- Build repositories around the phase contracts instead of letting the rest of the codebase issue ad hoc SQL.

### Daemon Topology
- The daemon is the dispatcher and source of truth for delivery lifecycle.
- Adapters should not poll SQLite directly.
- Publishing an event should persist it durably, then wake the in-process dispatcher path; background recovery scans only exist for restart recovery and stuck work detection.

## Deferred Questions
- Whether manifest hot reload is worth Phase 2 complexity or should remain a restart-based workflow in V1.
- Whether event replay should use dedicated replay tables or remain repository/service logic over the base event log.
- Whether later CLI commands should emit JSON Schema from Zod for editor integration.

## Sources
- Node.js SQLite docs: https://nodejs.org/download/release/v22.17.0/docs/api/sqlite.html
- SQLite WAL docs: https://sqlite.org/wal.html
- `yaml` project README: https://github.com/eemeli/yaml
- Zod project README: https://github.com/colinhacks/zod
