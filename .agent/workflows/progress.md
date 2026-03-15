---
description: Show planning status, execution projection freshness, and the next recommended action
---

# /progress Workflow

Repository override: in this project, `.planning/` is the canonical planning workspace. `.gsd/` is the execution projection used by Antigravity/Codex after `/sync-planning-to-gsd`.

<objective>
Quick status check: what is the canonical project state, is the execution projection fresh, and what should happen next?
</objective>

<process>

## 1. Load Canonical Planning State

Read:
- `.planning/STATE.md` — authoritative session continuity and current position
- `.planning/ROADMAP.md` — authoritative milestone and phase status
- `.planning/PROJECT.md` — optional project name / scope reminder

Also count:
- `.planning/todos/pending/*.md`
- `.planning/quick/*/`

---

## 2. Load Execution Projection

If present, read:
- `.gsd/STATE.md`
- `.gsd/ROADMAP.md`

Treat these as read-only projections for status display. Do not use `/progress` to imply that `.gsd/*.md` are the source of truth.

---

## 3. Calculate Planning Progress

From `.planning/ROADMAP.md` and `.planning/STATE.md`, determine:
- Total phases
- Completed phases
- In progress phases
- Blocked phases
- Not started phases
- Current phase / current plan
- Current milestone

Also summarize:
- Pending todo count from `.planning/todos/pending/`
- Completed quick-task count from the quick-task table in `.planning/STATE.md` or from `.planning/quick/*/*-SUMMARY.md`

---

## 4. Check Projection Freshness

Determine the `.gsd/` sync status:

- If `.gsd/STATE.md` or `.gsd/ROADMAP.md` is missing: projection missing
- If `.planning/STATE.md` or `.planning/ROADMAP.md` is newer than the `.gsd/` counterpart: projection stale
- If timestamps and content look aligned: projection current

If stale, recommend `/sync-planning-to-gsd` before any execution workflow.

---

## 5. Display Status

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PROGRESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT
───────
{project name}
Milestone: {current milestone}

───────────────────────────────────────────────────────

PLANNING SOURCE (.planning)

Current phase: {phase from .planning/STATE.md}
Current plan: {plan from .planning/STATE.md, or "None"}
Status: {status from .planning/STATE.md}

Progress: {completed}/{total} phases ({percentage}%)

{phase list from .planning/ROADMAP.md}

───────────────────────────────────────────────────────

EXECUTION PROJECTION (.gsd)

Sync status: {current | stale | missing}
Execution phase: {phase from .gsd/STATE.md, if present}
Execution note: {short note from .gsd/STATE.md, if useful}

───────────────────────────────────────────────────────

DEFERRED WORK

Pending todos: {count}
Quick tasks: {count}

───────────────────────────────────────────────────────

▶ NEXT UP

{Recommended next action}

───────────────────────────────────────────────────────
```

---

## 6. Suggest Action

Recommend exactly one next step based on the strongest condition:

| Condition | Recommendation |
|-----------|----------------|
| Planning changed and `.gsd/` is stale | `/sync-planning-to-gsd [phase]` |
| Phase needs research | `/research-phase {N}` |
| Phase needs plans | `/plan {N}` |
| Phase is planned and synced | `/execute {N}` |
| Phase execution complete, needs validation | `/verify {N}` |
| There is a small standalone task in `.planning/quick/` | `/quick {id-or-slug}` |
| User only needs deferred work review | `/check-todos` |

</process>
