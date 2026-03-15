---
description: Bring verified execution results from `.gsd/` back into canonical `.planning/`
argument-hint: "<phase-number>"
---

# /handoff-execution Workflow

Repository override: `.planning/` remains canonical. After Antigravity/Codex finish implementation or verification in `.gsd/`, use this workflow to make the execution results authoritative in `.planning/`.

<objective>
Persist phase execution results back into the planning workspace so Claude Code sees the updated roadmap, state, summaries, and verification files.
</objective>

<when_to_use>
- After `/execute {N}` materially changes `.gsd/STATE.md` or `.gsd/ROADMAP.md`
- After `/verify {N}` creates or updates `.gsd/phases/{N}/VERIFICATION.md`
- After gap-closure plans, summaries, or verification artifacts were created in `.gsd/`
</when_to_use>

<context>
**Phase:** $ARGUMENTS (required)

**Inputs:**
- `.gsd/ROADMAP.md`
- `.gsd/STATE.md`
- `.gsd/phases/{N}/`

**Outputs:**
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/phases/<NN-slug>/`
</context>

<process>

## 1. Validate Preconditions

Confirm:
- the phase exists in `.gsd/phases/{N}/`
- execution artifacts are present for that phase
- `.planning/phases/<NN-slug>/` exists for the same phase number

If the phase was never synced from planning in the first place, stop and repair the planning side first.

---

## 2. Run the Handoff Script

```bash
node scripts/handoff-execution-to-planning.mjs 6
```

This script:
- maps `.gsd/ROADMAP.md` back to `.planning/ROADMAP.md`
- maps `.gsd/STATE.md` back to `.planning/STATE.md`
- maps execution artifacts such as `*-SUMMARY.md`, `VERIFICATION.md`, and new gap-closure plans back into `.planning/phases/<NN-slug>/`
- removes auto-generated projection notices
- rewrites `.gsd/...` references back to `.planning/...`
- restores planning-style phase frontmatter such as `phase: 06-structured-logging`

---

## 3. Inspect the Canonical Planning Files

Review:
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/phases/<NN-slug>/*-SUMMARY.md`
- `.planning/phases/<NN-slug>/NN-VERIFICATION.md`

Confirm that:
- the completed phase status is now visible in `.planning/`
- the next phase recommendation is still correct
- any new gap-closure plans or verification artifacts are present in planning form

---

## 4. Continue from Canonical State

After handoff:
- Claude Code `/progress` should reflect the new canonical status
- future planning starts from `.planning/`, not stale `.gsd/`
- if planning changes again, run `/sync-planning-to-gsd` before the next execution wave

---

## 5. Commit the Handoff

```bash
git add .planning/ROADMAP.md .planning/STATE.md .planning/phases/
git commit -m "docs: handoff phase {N} execution back to planning"
```

</process>
