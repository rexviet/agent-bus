---
description: Context hygiene — save a clean handoff without treating .gsd projections as canonical state
---

# /pause Workflow

Repository override: save canonical handoff state in `.planning/STATE.md`. Use `.gsd/JOURNAL.md` only for execution-local notes. Do not write pause state into auto-generated `.gsd/STATE.md`.

<objective>
Safely pause planning or execution work with enough context for a clean next session.
</objective>

<when_to_use>
- Ending a work session
- Context is getting heavy
- Switching from planning to implementation, or vice versa
- Before taking a break
- After repeated failed debugging attempts
</when_to_use>

<process>

## 1. Decide the Handoff Track

Classify the current session:
- Planning / research work → save to `.planning/STATE.md`
- Execution / verification work → save canonical next-step state to `.planning/STATE.md`, and detailed execution notes to `.gsd/JOURNAL.md`

If both happened in the same session, update both files.

---

## 2. Update Canonical State

Update `.planning/STATE.md` with the information that must survive future syncs:

```markdown
## Current Position
- **Track**: planning | execution | mixed
- **Phase**: {current phase number and name}
- **Task**: {specific task in progress, if any}
- **Status**: Paused at {timestamp}

## Last Session Summary
{What was accomplished this session}

## In-Progress Work
{Any uncommitted changes or partial work}
- Files modified: {list}
- Tests status: {passing / failing / not run}

## Blockers
{What is preventing progress, if anything}

## Context Dump
{Critical context that would otherwise be lost}

### Decisions Made
- {Decision 1}: {rationale}
- {Decision 2}: {rationale}

### Approaches Tried
- {Approach 1}: {outcome}
- {Approach 2}: {outcome}

### Current Hypothesis
{Best current hypothesis}

### Files of Interest
- `{file1}`: {what matters}
- `{file2}`: {what matters}

## Next Steps
1. {Specific first action for next session}
2. {Second priority}
3. {Third priority}
```

This file is the canonical restart point for `/resume`.

---

## 3. Append Execution Notes When Relevant

If you were implementing or verifying code, append a session entry to `.gsd/JOURNAL.md`:

```markdown
## Session: {YYYY-MM-DD HH:MM}

### Objective
{What this session was trying to accomplish}

### Accomplished
- {Item 1}
- {Item 2}

### Verification
- [x] {What was verified}
- [ ] {What still needs verification}

### Paused Because
{Reason for pausing}

### Handoff Notes
{Critical info for resuming execution}
```

Use `.gsd/JOURNAL.md` for execution detail, not `.gsd/STATE.md`.

---

## 4. Sync If Planning Changed

If the paused session changed planning docs that execution depends on:
- run `/sync-planning-to-gsd` before stopping, or
- explicitly note in `.planning/STATE.md` that `.gsd/` is stale and must be re-synced first

---

## 5. Commit State Notes When Appropriate

```bash
git add .planning/STATE.md
git add .gsd/JOURNAL.md  # if updated
git commit -m "docs: pause session - {brief reason}"
```

Skip the commit if the user wants to keep the handoff notes uncommitted for now.

---

## 6. Display Handoff

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► SESSION PAUSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

State saved to:
• .planning/STATE.md
• .gsd/JOURNAL.md (if execution notes were added)

───────────────────────────────────────────────────────

To resume later:

/resume

───────────────────────────────────────────────────────
```

</process>

<context_hygiene>
If pausing due to debugging failures:

1. Record exactly what failed
2. Include exact error messages or failing tests
3. List the files touched
4. State the current hypothesis clearly
5. State what to try next, and what not to retry blindly
</context_hygiene>

<proactive_state_save>
## Proactive Auto-Save

If context is getting risky, save first:

1. Write a lightweight snapshot to `.planning/STATE.md`
2. If execution is active, append a short note to `.gsd/JOURNAL.md`
3. Then recommend `/pause`

### Minimum Auto-Save Content

```markdown
## Auto-Save: {timestamp}
- **Track**: {planning | execution}
- **Phase**: {current phase}
- **Task**: {current task or "between tasks"}
- **Last Action**: {what just completed}
- **Next Step**: {what should happen next}
```
</proactive_state_save>
