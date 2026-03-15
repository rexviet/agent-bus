---
description: List canonical todo notes from the planning workspace
argument-hint: "[--all] [--area <name>]"
---

# /check-todos Workflow

Repository override: list todo items from `.planning/todos/`. `.gsd/TODO.md` is only a projection for execution-side visibility.

<objective>
Display pending todo notes, optionally including completed items or filtering by area.
</objective>

<context>
**Flags:**
- `--all` — Show completed items from `.planning/todos/done/` too
- `--area <name>` — Filter by the `area` frontmatter field

**Canonical inputs:**
- `.planning/todos/pending/*.md`
- `.planning/todos/done/*.md` when `--all` is used
</context>

<process>

## 1. Load Todo Files

Read:
- all markdown files in `.planning/todos/pending/`
- all markdown files in `.planning/todos/done/` if `--all` is present

If none exist, display:
`No todos found. Use /add-todo to capture one.`

---

## 2. Parse and Filter

For each todo file, extract:
- `title`
- `created`
- `area`
- file path

Filter by `--area` if provided.

Classify:
- pending = file under `.planning/todos/pending/`
- done = file under `.planning/todos/done/`

---

## 3. Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► TODOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PENDING ({N} items)
───────────────────
- {title} `{area}` — {created} [{path}]

{If --all:}
COMPLETED ({M} items)
─────────────────────
- {title} `{area}` — {created} [{path}]

───────────────────────────────────────────────────────

/add-todo <title>
/sync-planning-to-gsd --root-only   # refresh `.gsd/TODO.md` if needed

───────────────────────────────────────────────────────
```

</process>
