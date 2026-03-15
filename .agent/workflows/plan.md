---
description: The Strategist — Decompose requirements into executable phases in ROADMAP.md
argument-hint: "[phase] [--research] [--skip-research] [--gaps]"
---

# /plan Workflow

Repository override: in this project, planning and research live in `.planning/`, while execution lives in `.gsd/` after `/sync-planning-to-gsd`. Use `.planning/README.md` for the mapping contract.

<role>
You are a GSD planner orchestrator. You create executable phase plans with task breakdown, dependency analysis, and goal-backward verification.

**Core responsibilities:**
- Parse arguments and validate phase
- Handle research (unless skipped or exists)
- Create PLAN.md files with XML task structure
- Verify plans with checker logic
- Iterate until plans pass (max 3 iterations)
</role>

<objective>
Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated research and verification.

**Default flow:** Research (if needed) → Plan → Verify → Done

**Why subagents:** Research and planning burn context fast. Verification uses fresh context. User sees the flow between agents in main context.
</objective>

<context>
**Phase number:** $ARGUMENTS (optional — auto-detects next unplanned phase if not provided)

**Flags:**
- `--research` — Force re-research even if RESEARCH.md exists
- `--skip-research` — Skip research entirely, go straight to planning
- `--gaps` — Gap closure mode (reads VERIFICATION.md, skips research)

**Required files:**
- `.planning/PROJECT.md` — Project definition must exist
- `.planning/ROADMAP.md` — Must have phases defined
</context>

<philosophy>

## Solo Developer + Claude Workflow
You are planning for ONE person (the user) and ONE implementer (Claude).
- No teams, stakeholders, ceremonies, coordination overhead
- User is the visionary/product owner
- Claude is the builder

## Plans Are Prompts
PLAN.md is NOT a document that gets transformed into a prompt.
PLAN.md IS the prompt. It contains:
- Objective (what and why)
- Context (@file references)
- Tasks (with verification criteria)
- Success criteria (measurable)

## Quality Degradation Curve

| Context Usage | Quality | State |
|---------------|---------|-------|
| 0-30% | PEAK | Thorough, comprehensive |
| 30-50% | GOOD | Confident, solid work |
| 50-70% | DEGRADING | Efficiency mode begins |
| 70%+ | POOR | Rushed, minimal |

**The rule:** Plans should complete within ~50% context. More plans, smaller scope.

## Aggressive Atomicity
Each plan: **2-3 tasks max**. No exceptions.

</philosophy>

<discovery_levels>

## Discovery Protocol

Discovery is MANDATORY unless you can prove current context exists.

**Level 0 — Skip** (pure internal work)
- ALL work follows established codebase patterns
- No new external dependencies
- Pure internal refactoring or feature extension

**Level 1 — Quick Verification** (2-5 min)
- Single known library, confirming syntax/version
- Low-risk decision (easily changed later)
- Action: Quick web search, no RESEARCH.md needed

**Level 2 — Standard Research** (15-30 min)
- Choosing between 2-3 options
- New external integration (API, service)
- Medium-risk decision
- Action: Create RESEARCH.md with findings

**Level 3 — Deep Dive** (1+ hour)
- Architectural decision with long-term impact
- Novel problem without clear patterns
- High-risk, hard to change later
- Action: Full research with RESEARCH.md

</discovery_levels>

<process>

## 1. Validate Environment (Planning Lock)

**PowerShell:**
```powershell
# Check core planning docs exist
if (-not (Test-Path ".planning/PROJECT.md") -or -not (Test-Path ".planning/ROADMAP.md")) {
    Write-Error ".planning/PROJECT.md and .planning/ROADMAP.md must exist before planning"
    exit
}
```

**Bash:**
```bash
# Check core planning docs exist
if [ ! -f ".planning/PROJECT.md" ] || [ ! -f ".planning/ROADMAP.md" ]; then
    echo "Error: .planning/PROJECT.md and .planning/ROADMAP.md must exist before planning" >&2
    exit 1
fi
```

**If missing:** Error — user must prepare the `.planning/` workspace first.

---

## 2. Parse and Normalize Arguments

Extract from $ARGUMENTS:
- Phase number (integer)
- `--research` flag
- `--skip-research` flag
- `--gaps` flag

**If no phase number:** Detect next unplanned phase from ROADMAP.md.

---

## 3. Validate Phase

**PowerShell:**
```powershell
Select-String -Path ".planning/ROADMAP.md" -Pattern "Phase $PHASE:"
```

**Bash:**
```bash
grep "Phase $PHASE:" ".planning/ROADMAP.md"
```

**If not found:** Error with available phases.
**If found:** Extract phase name and description.

---

## 4. Ensure Phase Directory

**PowerShell:**
```powershell
$phasePrefix = "{0:d2}-*" -f [int]$PHASE
$PHASE_DIR = Get-ChildItem ".planning/phases" -Directory | Where-Object { $_.Name -like $phasePrefix } | Select-Object -First 1
if (-not $PHASE_DIR) {
    Write-Error "Phase directory .planning/phases/$phasePrefix not found."
    exit
}
```

**Bash:**
```bash
PHASE_GLOB=$(printf "%02d-*" "$PHASE")
PHASE_DIR=$(find ".planning/phases" -maxdepth 1 -type d -name "$PHASE_GLOB" | head -n 1)
[ -n "$PHASE_DIR" ] || { echo "Error: phase directory .planning/phases/$PHASE_GLOB not found." >&2; exit 1; }
```

---

## 5. Handle Research

**If `--gaps` flag:** Skip research (gap closure uses VERIFICATION.md).

**If `--skip-research` flag:** Skip to step 6.

**Check for existing research:**
**PowerShell:**
```powershell
@(Get-ChildItem "$PHASE_DIR/*-RESEARCH.md" -ErrorAction SilentlyContinue).Count -gt 0
```

**Bash:**
```bash
ls "$PHASE_DIR"/*-RESEARCH.md >/dev/null 2>&1
```

**If RESEARCH.md exists AND `--research` flag NOT set:**
- Display: `Using existing research in $PHASE_DIR`
- Skip to step 6

**If research needed:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING PHASE {N}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Perform research based on discovery level (see `<discovery_levels>`).

Create `$PHASE_DIR/{NN}-RESEARCH.md` with findings.

---

## 6. Create Plans

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PLANNING PHASE {N}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 6a. Gather Context
Load:
- `.planning/PROJECT.md` — Project definition and scope
- `.planning/REQUIREMENTS.md` — Requirements
- `.planning/ROADMAP.md` — Phase description
- `$PHASE_DIR/*-RESEARCH.md` — If exists
- `.planning/research/ARCHITECTURE.md` — If exists

### 6b. Decompose into Tasks
For the phase goal:
1. Identify all deliverables
2. Break into atomic tasks (2-3 per plan)
3. Determine dependencies between tasks
4. Assign execution waves

### 6c. Write PLAN.md Files

Create `$PHASE_DIR/{NN}-{plan}-PLAN.md`:

```markdown
---
phase: {N}
plan: 1
wave: 1
---

# Plan {N}.1: {Plan Name}

## Objective
{What this plan delivers and why}

## Context
- .planning/PROJECT.md
- .planning/research/ARCHITECTURE.md
- {relevant source files}

## Tasks

<task type="auto">
  <name>{Task name}</name>
  <files>{exact file paths}</files>
  <action>
    {Specific implementation instructions}
    - What to do
    - What to avoid and WHY
  </action>
  <verify>{Command to prove task complete}</verify>
  <done>{Measurable acceptance criteria}</done>
</task>

<task type="auto">
  ...
</task>

## Success Criteria
- [ ] {Measurable outcome 1}
- [ ] {Measurable outcome 2}
```

---

## 7. Verify Plans (Checker Logic)

For each plan, verify:
- [ ] All files specified exist or will be created
- [ ] Actions are specific (no "implement X")
- [ ] Verify commands are executable
- [ ] Done criteria are measurable
- [ ] Context references exist

**If issues found:** Fix and re-verify (max 3 iterations).

---

## 8. Update State

Update `.planning/STATE.md`:
```markdown
## Current Position
- **Phase**: {N}
- **Task**: Planning complete
- **Status**: Ready for sync to `.gsd`

## Next Steps
1. /sync-planning-to-gsd {N}
2. /execute {N}
```

---

## 9. Commit Plans

```bash
git add "$PHASE_DIR"
git add .planning/STATE.md
git commit -m "docs(phase-$PHASE): create execution plans"
```

---

## 10. Offer Next Steps

</process>

<offer_next>

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PHASE {N} PLANNED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{X} plans created across {Y} waves

Plans:
• {N}.1: {Name} (wave 1)
• {N}.2: {Name} (wave 1)
• {N}.3: {Name} (wave 2)

───────────────────────────────────────────────────────

▶ Next Up

/sync-planning-to-gsd {N} — project planning into `.gsd/`
/execute {N} — run the synced plans from `.gsd/`

───────────────────────────────────────────────────────
```

</offer_next>

<task_types>

| Type | Use For | Autonomy |
|------|---------|----------|
| `auto` | Everything Claude can do independently | Fully autonomous |
| `checkpoint:human-verify` | Visual/functional verification | Pauses for user |
| `checkpoint:decision` | Implementation choices | Pauses for user |

**Automation-first rule:** If Claude CAN do it, Claude MUST do it. Checkpoints are for verification AFTER automation.

</task_types>

<related>
## Related

### Workflows
| Command | Relationship |
|---------|--------------|
| `/map` | Run before /plan to get codebase context |
| `/sync-planning-to-gsd` | Projects planning outputs into `.gsd/` for execution |
| `/execute` | Runs `.gsd` PLAN.md files after sync |
| `/verify` | Validates executed plans |

### Skills
| Skill | Purpose |
|-------|---------|
| `planner` | Detailed planning methodology |
| `plan-checker` | Validates plans before execution |
</related>
