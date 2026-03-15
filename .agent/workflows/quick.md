---
description: Execute a standalone quick task from .planning/quick without phase-level roadmap overhead
argument-hint: "[task-id-or-slug]"
---

# /quick Workflow

Repository override: quick tasks live in `.planning/quick/` and are executed directly from that workspace. They are not part of the normal `.planning/phases/` -> `.gsd/phases/` sync flow unless a separate projection is added later.

<objective>
Handle a small, self-contained implementation task without introducing a full roadmap phase.
</objective>

<when_to_use>
- Small implementation work that does not justify a new roadmap phase
- Focused follow-up work with a single plan file
- Standalone tooling or ergonomics work that still deserves a plan and summary
</when_to_use>

<context>
**Task selector:** $ARGUMENTS (optional)

**Canonical location:**
- `.planning/quick/<id-or-slug>/`

**Expected files:**
- `*-PLAN.md` — execution prompt
- `*-SUMMARY.md` — completion record after the work is done
</context>

<process>

## 1. Discover Quick Tasks

List directories under `.planning/quick/`.

Resolve the task to use:
- If an argument is provided, match by numeric prefix or slug fragment
- If no argument is provided, prefer the only directory that has a `*-PLAN.md` but no matching `*-SUMMARY.md`
- If multiple candidates remain, list them and stop for user selection

---

## 2. Load the Plan

Read the selected quick-task `*-PLAN.md`.

Confirm:
- the objective is still current
- the scope is small enough to remain a quick task
- dependencies or required files are available

If the work has outgrown a quick task, stop and move it into normal phase planning.

---

## 3. Execute Directly From `.planning/quick/`

Use the quick-task plan as the execution prompt:
- follow `<task>` blocks in order
- run the listed verification commands
- make atomic commits if the plan calls for them

Quick tasks execute directly from `.planning/quick/`; do not force them through `.gsd/phases/`.

---

## 4. Write the Summary

After implementation, create or update `*-SUMMARY.md` in the same quick-task directory.

The summary should capture:
- what changed
- verification that actually ran
- commits or notable decisions
- any follow-up work that should move into `.planning/todos/` or a future roadmap phase

---

## 5. Update Project Continuity

Reflect durable outcomes in `.planning/STATE.md`:
- current position if this interrupts or changes phase work
- quick-task completion table if relevant
- next recommended action

If the quick task changed planning-facing docs that execution consumers need, run `/sync-planning-to-gsd --root-only`.

---

## 6. Offer Next Steps

Typical follow-up:
- `/progress` — return to the broader roadmap
- `/execute {N}` — continue the active phase
- `/add-todo ...` — capture deferred follow-up

</process>
