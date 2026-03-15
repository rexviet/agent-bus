---
description: Capture a todo item as a canonical planning note
argument-hint: "<title> [--area <name>] [--files <path[,path...]>]"
---

# /add-todo Workflow

Repository override: in this project, todos live in `.planning/todos/pending/` and `.planning/todos/done/`. `.gsd/TODO.md` is only a synced projection.

<objective>
Capture a deferred task or idea without interrupting the current workflow.
</objective>

<context>
**Item:** $ARGUMENTS

**Flags:**
- `--area <name>` — Optional ownership / topic tag such as `daemon`, `cli`, `docs`, or `general`
- `--files <path[,path...]>` — Optional related files to pre-link in the note

**Canonical output:**
- `.planning/todos/pending/YYYY-MM-DD-slug.md`
</context>

<process>

## 1. Parse Arguments

Extract:
- Title
- Area (default: `general`)
- Optional file list

Use the title to create a filesystem-safe slug.

---

## 2. Ensure Todo Directories Exist

Confirm:
- `.planning/todos/pending/`
- `.planning/todos/done/`

Create missing directories if needed.

---

## 3. Create the Todo File

Create `.planning/todos/pending/{YYYY-MM-DD}-{slug}.md` with this structure:

```markdown
---
created: {ISO timestamp}
title: {title}
area: {area}
files:
  - {path1}
  - {path2}
---

## Problem

{Why this item matters}

## Solution

{What change is desired}
```

If no related files were supplied, omit the `files` block.

Keep the body short if the user only needs a quick capture.

---

## 4. Confirm

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► TODO ADDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Saved:
{new file path}

Area: {area}

───────────────────────────────────────────────────────

/check-todos
/sync-planning-to-gsd --root-only   # if `.gsd/TODO.md` needs refresh

───────────────────────────────────────────────────────
```

</process>
