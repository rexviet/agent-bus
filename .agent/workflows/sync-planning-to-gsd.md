---
description: Project planning docs from `.planning/` into `.gsd/` for Antigravity/Codex execution
argument-hint: "[phase-number] [--root-only] [--phases-only]"
---

# /sync-planning-to-gsd Workflow

<objective>
Project the Claude Code planning workspace in `.planning/` into the Antigravity/Codex execution workspace in `.gsd/`.

Use this after planning or research changes in `.planning/`, before running execution-oriented workflows from `.gsd/`.
</objective>

<context>
**Source of truth for planning:** `.planning/`

**Execution workspace:** `.gsd/`

**Arguments:**
- `[phase-number]` — Optional. Sync only one phase directory plus the shared root docs.

**Flags:**
- `--root-only` — Sync shared project docs only
- `--phases-only` — Sync phase directories only
</context>

<process>

## 1. Validate Source Workspace

Confirm these exist:
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/phases/`

If missing: stop and fix planning inputs first.

---

## 2. Decide Sync Scope

- No phase argument: sync all planning phases into `.gsd/phases/{N}/`
- With phase argument: sync only that phase number
- `--root-only`: only sync shared docs such as PROJECT, REQUIREMENTS, ROADMAP, STATE, research docs, and todo projection
- `--phases-only`: only sync phase files

---

## 3. Run the Sync Script

**Bash:**
```bash
node scripts/sync-planning-to-gsd.mjs
node scripts/sync-planning-to-gsd.mjs --phase 6
node scripts/sync-planning-to-gsd.mjs --phase 6 --phases-only
```

**What it does:**
- Maps `.planning/PROJECT.md` to `.gsd/SPEC.md`
- Maps shared research docs into `.gsd/`
- Maps `.planning/phases/<NN-slug>/` into `.gsd/phases/{N}/`
- Rewrites embedded `.planning/...` references to `.gsd/...`
- Rewrites phase file names like `06-01-PLAN.md` to `01-PLAN.md`
- Preserves Antigravity/Codex-facing `.gsd` structure
- Does not project `.planning/quick/`; standalone quick tasks execute directly from `.planning/` via `/quick`

---

## 4. Inspect the Projection

Check the generated files:
- `.gsd/SPEC.md`
- `.gsd/ROADMAP.md`
- `.gsd/STATE.md`
- `.gsd/phases/{N}/`

Spot-check that:
- Paths inside synced plan files now point at `.gsd/...`
- Phase frontmatter uses numeric `phase: {N}`
- The expected plan files exist for execution

---

## 5. Proceed with Execution

After sync:
- Claude Code continues planning in `.planning/`
- Antigravity or Codex execute from `.gsd/`

Typical sequence:
1. Plan/research in `.planning/`
2. Run `/sync-planning-to-gsd`
3. Execute in `.gsd/`
4. Run `/handoff-execution {N}` when execution results should become canonical in `.planning/`

</process>

<notes>
- This is a one-way projection from `.planning/` into `.gsd/`.
- Re-run it after planning changes before starting the next implementation wave.
- Generated files include an auto-generated notice pointing back to the `.planning/` source file.
</notes>
