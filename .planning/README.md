# Planning Workspace

This repository uses a dual-workspace model.

- `.planning/` is the Claude Code planning and research workspace.
- `.gsd/` is the Antigravity/Codex execution workspace.

Use `.planning/` as the source of truth for planning. When planning changes are ready for execution, project them into `.gsd/` with `/sync-planning-to-gsd` or `node scripts/sync-planning-to-gsd.mjs`.

## `.planning/` Scope

- `.planning/PROJECT.md` — project definition and product scope
- `.planning/REQUIREMENTS.md` — requirement tracking
- `.planning/ROADMAP.md` — milestone and phase sequencing
- `.planning/STATE.md` — planning-session continuity
- `.planning/phases/<NN-slug>/` — phase context, plans, summaries, validation, verification
- `.planning/quick/` — standalone quick-task plan and summary directories
- `.planning/research/` — shared architecture and stack research
- `.planning/todos/` — pending and completed todo capture

## `.gsd/` Scope

- `.gsd/SPEC.md`, `.gsd/ROADMAP.md`, `.gsd/STATE.md` — execution-facing projections
- `.gsd/phases/{N}/` — numeric execution directories for Antigravity/Codex
- `.gsd/JOURNAL.md`, `.gsd/DECISIONS.md` — execution-side notes and history

## Phase Directory Convention

Planning phase directories use a zero-padded numeric prefix plus slug:

```text
.planning/phases/05-foundation-safety/
.planning/phases/06-structured-logging/
```

The sync workflow maps those to numeric `.gsd` directories:

```text
.gsd/phases/5/
.gsd/phases/6/
```

## Default Mapping

| Planning Source | Execution Projection |
|-----------------|----------------------|
| `.planning/PROJECT.md` | `.gsd/SPEC.md` |
| `.planning/REQUIREMENTS.md` | `.gsd/REQUIREMENTS.md` |
| `.planning/ROADMAP.md` | `.gsd/ROADMAP.md` |
| `.planning/STATE.md` | `.gsd/STATE.md` |
| `.planning/research/ARCHITECTURE.md` | `.gsd/ARCHITECTURE.md` |
| `.planning/research/STACK.md` | `.gsd/STACK.md` |
| `.planning/phases/<NN-slug>/NN-*.md` | `.gsd/phases/{N}/*.md` |
| `.planning/todos/pending/*.md` | `.gsd/TODO.md` |

Quick tasks under `.planning/quick/` are executed directly from `.planning/` and are not projected into `.gsd/` by the current sync workflow.
