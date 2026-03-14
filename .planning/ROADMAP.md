# Roadmap

> **Current Milestone:** v1.1 (Planning)
> **Last completed phase:** Phase 4 (v1.0)

## Milestone Plan

### v1.1 — Production Hardening
Process timeout, structured logging, concurrent workers, env isolation for spawned processes.

**MCP Server** — Agents publish events directly via MCP tool (`publish_event`) instead of relying on the worker to publish from the result envelope. The result envelope is simplified to carry only `status` + `outputArtifacts`. MCP server runs embedded in the daemon, exposes tools: `publish_event`, `get_delivery`, `list_artifacts`. Connection info (stdio/HTTP) passed to agents via work package env vars. Enables agent identity files to be self-contained (create envelope + publish in one step).

### v1.2 — Developer Experience
SDK/library mode, event schema registry, web dashboard, plugin system for adapters.

### v1.3 — Scale & Ecosystem
PostgreSQL backend option, distributed worker support, adapter marketplace, multi-repo orchestration.

## Phases

(Phases will be defined when each milestone is planned via `/gsd:new-milestone`)
