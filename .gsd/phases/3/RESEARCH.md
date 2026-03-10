---
phase: 3
researched_at: 2026-03-10
discovery_level: 2
---

# Phase 3 Research

## Objective
Determine the safest adapter contract and execution strategy for real Codex, Open Code, and Antigravity integrations without breaking the daemon-owned orchestration model from Phase 2.

## Discovery Level
**Level 2** — Standard research

## Key Decisions

### Decision 1: Use a file-backed adapter contract
**Question:** How should runtime workers receive work and report results?
**Options Considered:**
1. Direct SQLite access from runtime workers: simplest to wire initially, but it breaks the daemon-owned reliability model and couples every runtime to storage internals.
2. Stdout-only contracts: easy for one CLI, but fragile because each runtime formats output differently and human-readable text is not a stable control plane.
3. File-backed JSON input/output envelopes owned by the daemon: one stable contract across runtimes, explicit artifact paths, and no direct database dependency.

**Decision:** Use daemon-written input files plus daemon-read result files as the adapter contract.
**Confidence:** High

### Decision 2: Keep runtime invocation vendor-specific behind adapter builders
**Question:** Should Agent Bus standardize one universal command shape for every runtime?
**Options Considered:**
1. Force every runtime into one fake `run` shape: simple on paper, but already false for the installed CLIs.
2. Build one adapter per runtime family behind a shared contract: lets the daemon stay generic while each runtime uses the command surface it actually supports.
3. Use vendor SDKs directly: possible for some runtimes, but inconsistent across the three targets and unnecessary for V1.

**Decision:** Use a shared contract plus runtime-specific adapter builders for `codex`, `open-code`, and `antigravity`.
**Confidence:** High

### Decision 3: Prefer short-lived CLI execution first, then optimize later
**Question:** Should Phase 3 start with persistent runtime servers or direct command execution?
**Options Considered:**
1. Long-lived servers or sockets for every runtime: lower latency later, but adds lifecycle complexity before the contract is proven.
2. Short-lived command execution with stable input/output files: simpler, easier to test, and fits the one-machine repository model.
3. Mixed mode from day one: flexible, but too much moving surface for the first real adapter phase.

**Decision:** Start with short-lived command execution. Keep Open Code server attach and other persistent-session optimizations as follow-up improvements after the contract is stable.
**Confidence:** Medium

## Findings

### Current repo architecture already provides the right durable boundary
Phase 2 left the daemon with durable publish, approval, claim, fail, retry, replay, and recovery services. The missing piece is the adapter execution path between `claimDelivery()` and either `acknowledgeDelivery()` or `failDelivery()`.

The current manifest already has useful adapter fields:
- `runtime`
- `command`
- `workingDirectory`
- `environment`

That means Phase 3 does not need to redesign repository configuration before adding real adapters.

**Sources:**
- Local code inspection on 2026-03-10:
  - `src/daemon/index.ts`
  - `src/daemon/delivery-service.ts`
  - `src/daemon/publish-event.ts`
  - `src/config/manifest-schema.ts`

### Codex already exposes a non-interactive CLI surface
The installed `codex` binary exposes `codex exec` for non-interactive runs, supports setting the working directory, and can write the final assistant message to a file. The official project docs also describe Codex as a CLI-oriented coding agent that can run locally against the repository.

This makes Codex a strong fit for a daemon-owned adapter that writes a prompt file, invokes `codex exec`, and asks the runtime to produce artifacts plus a structured result file inside the shared workspace or state directory.

**Sources:**
- Local CLI inspection on 2026-03-10:
  - `codex --help`
  - `codex exec --help`
- Official docs:
  - https://github.com/openai/codex
  - https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started

### Open Code already exposes a non-interactive run command
The installed binary is `opencode`, not `open-code`. It supports `opencode run`, accepts a working directory, file attachments, and a JSON event format. Open Code also documents CLI-driven usage, which fits the adapter model well.

This means the manifest-level runtime name should stay stable for Agent Bus, but the concrete binary invocation should not be hardcoded from old examples. The adapter layer should own that translation.

**Sources:**
- Local CLI inspection on 2026-03-10:
  - `opencode --help`
  - `opencode run --help`
- Official docs:
  - https://opencode.ai/docs/cli

### Antigravity is real, but its CLI is more editor-centric
The installed `antigravity` binary exposes `antigravity chat` with `--mode agent` and file attachments, but its CLI shape is closer to an editor assistant than a headless structured-output worker. Google's Antigravity guidance also emphasizes repository artifacts, rules, and planning workflows rather than a strict stdout API.

That makes Antigravity the highest-risk runtime for automation drift. The contract should therefore rely on files, not terminal output. A thin wrapper or prompt convention is the safest path for Phase 3.

**Sources:**
- Local CLI inspection on 2026-03-10:
  - `antigravity --help`
  - `antigravity chat --help`
- Official guidance:
  - https://codelabs.developers.google.com/codelabs/antigravity-rules

## Patterns to Follow
- Daemon-owned reliability: adapters should never inspect or mutate SQLite directly.
- File-backed control plane: the daemon writes a work package JSON file and expects a result JSON file back.
- Shared workspace artifact flow: adapters read and write files through repository-relative artifact paths that resolve under the manifest workspace.
- Runtime-specific command builders: keep vendor flags isolated behind adapter modules instead of spreading them through daemon logic.
- Availability-aware verification: deterministic tests should use fixture adapters, while real-runtime smoke checks should skip cleanly if binaries or auth are unavailable.

## Anti-Patterns to Avoid
- Direct database polling from runtime workers: this would undo the Phase 2 service boundary.
- Parsing human-readable stdout as the source of truth: CLI text changes too easily across vendors and versions.
- Hardcoding example binary names into core orchestration semantics: `open-code` is already wrong on this machine, while the manifest runtime label can remain stable.
- Pulling Phase 4 operator UX into Phase 3: runtime execution belongs here, broad operator commands do not.

## Dependencies Identified
| Package | Version | Purpose |
|---------|---------|---------|
| Node.js stdlib (`child_process`, `fs/promises`, `path`) | existing | Spawn adapter commands, materialize contract files, and capture results/logs |
| `codex` CLI | external runtime prerequisite | Real Codex adapter execution |
| `opencode` CLI | external runtime prerequisite | Real Open Code adapter execution |
| `antigravity` CLI | external runtime prerequisite | Real Antigravity adapter execution |

No new npm dependency is required for the first adapter pass.

## Risks
- **Antigravity automation ambiguity:** Its CLI is not obviously structured-output-first. Mitigation: keep the control plane file-based and isolate the runtime-specific wrapper.
- **Binary and auth drift:** A runtime may be installed but not authenticated or not configured with a usable model. Mitigation: adapters must fail fast with explicit diagnostics and log paths.
- **Prompt/result contract drift across runtimes:** Each vendor prefers different invocation patterns. Mitigation: keep the daemon contract stable and vendor prompts thin.

## Recommendations for Planning
1. Start with a contract-first plan that locks the file-backed work/result envelope before any process spawning code lands.
2. Add the generic daemon worker and fixture-based execution tests before touching vendor-specific command builders.
3. Implement Codex and Open Code ahead of Antigravity because their non-interactive CLI surfaces are stronger.
4. Update the shipped manifests during the final adapter plan so the repository reflects actual runtime command names and expectations.
