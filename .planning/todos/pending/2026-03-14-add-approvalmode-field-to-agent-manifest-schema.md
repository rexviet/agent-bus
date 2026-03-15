---
created: 2026-03-14T14:24:36.057Z
title: Add approvalMode field to agent manifest schema
area: general
files:
  - src/adapters/vendors/gemini.ts:99-101
  - src/config/manifest-schema.ts:49-58
---

## Problem

Approval mode is currently hardcoded in each vendor adapter. In `gemini.ts:99-101`, `auto_edit` is hardcoded as the default if the operator doesn't manually pass `--approval-mode` in the manifest `command` array. Operators cannot declaratively configure this per-agent in YAML — they must either accept the hardcoded default or hack it via raw CLI args.

This means different agents in the same manifest cannot have different approval modes without overriding via the `command` field manually.

## Solution

Add an optional `approvalMode` field to `AgentSchema` in `manifest-schema.ts`:

```yaml
agents:
  - id: planner
    runtime: gemini
    approvalMode: yolo       # or: auto_edit, default
    timeout: 300
    command: [gemini]
```

Each vendor adapter (`gemini.ts`, `codex.ts`, `open-code.ts`) reads `agent.approvalMode` and maps it to the CLI-specific flag:

| approvalMode | Gemini flag | Codex flag |
|---|---|---|
| `auto_edit` | `auto_edit` | `auto-edit` |
| `yolo` | `yolo` | `full-auto` |
| `default` | `default` | `suggest` |

Inspired by the `spawn-agent` skill's `--auto-edit / --yolo / --safe` abstraction pattern (compared during Phase 5 review session).
