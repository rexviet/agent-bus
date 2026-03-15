---
description: Restore context from canonical planning state plus recent execution notes
---

# /resume Workflow

Repository override: resume from `.planning/STATE.md` first. `.gsd/STATE.md` is only a projection snapshot and should not be treated as the canonical handoff document.

<objective>
Start a fresh session with the minimum files needed to continue correctly.
</objective>

<process>

## 1. Load Canonical State

Read completely:
- `.planning/STATE.md`

Also read as needed:
- `.planning/ROADMAP.md`
- `.planning/PROJECT.md`

---

## 2. Load Execution Context If Relevant

If the last session was implementation or verification work, inspect:
- `.gsd/JOURNAL.md` — latest execution session notes
- `.gsd/ROADMAP.md` — execution projection status
- `.gsd/phases/{N}/` — active phase plan / summary / verification files when continuing a specific phase

Do not rely on `.gsd/STATE.md` as the source of truth.

---

## 3. Check Projection Freshness

Compare `.planning/` against `.gsd/`:

- If `.gsd/` is missing: execution workspace not synced yet
- If `.planning/STATE.md` or `.planning/ROADMAP.md` is newer: `.gsd/` is stale
- If `.gsd/STATE.md` or `.gsd/ROADMAP.md` is newer because execution advanced: canonical planning handoff is pending
- If they match closely: execution workspace is ready

If stale, the next step is usually `/sync-planning-to-gsd` before `/execute`.
If execution is ahead, the next step is usually `/handoff-execution {N}` before trusting `.planning/` as current.

---

## 4. Check Worktree Status

```bash
git status --porcelain
```

If changes exist, surface them before suggesting the next command.

---

## 5. Mark Session Active

If you need to persist the restart moment, update `.planning/STATE.md`:

```markdown
**Status**: Active (resumed {timestamp})
```

Do not write this into `.gsd/STATE.md`.

---

## 6. Display Context

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESUMING SESSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAST POSITION
─────────────
Track: {track from .planning/STATE.md}
Phase: {phase}
Task: {task}
Status: {status when paused}

───────────────────────────────────────────────────────

CONTEXT FROM LAST SESSION
─────────────────────────
{Context dump from .planning/STATE.md}

───────────────────────────────────────────────────────

EXECUTION NOTES
───────────────
{Latest relevant notes from .gsd/JOURNAL.md, if any}

───────────────────────────────────────────────────────

SYNC STATUS
───────────
{current | stale | missing}

───────────────────────────────────────────────────────

NEXT STEPS
──────────
1. {First priority}
2. {Second priority}
3. {Third priority}

───────────────────────────────────────────────────────
```

---

## 7. Suggest Action

Recommend the single best next command:

- `/research-phase {N}` — if the phase still needs discovery
- `/plan {N}` — if planning is the current task
- `/sync-planning-to-gsd {N}` — if `.planning/` changed after the last sync
- `/handoff-execution {N}` — if `.gsd/` contains newer execution results than `.planning/`
- `/execute {N}` — if the phase is planned and synced
- `/verify {N}` — if implementation is done and proof is next
- `/quick {id-or-slug}` — if the active work is a standalone quick task
- `/progress` — if the user just needs the broader roadmap picture

</process>
