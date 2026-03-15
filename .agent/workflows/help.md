---
description: Show all available GSD commands
---

# /help Workflow

<objective>
Display all available GSD commands with descriptions and usage hints.
</objective>

<process>

**First, read and display the version:**

**PowerShell:**
```powershell
$version = Get-Content "VERSION" -ErrorAction SilentlyContinue
if (-not $version) { $version = "unknown" }
```

**Bash:**
```bash
version=$(cat VERSION 2>/dev/null || echo "unknown")
```

**Then display help with version in header:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► HELP (v{version})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CORE WORKFLOW
─────────────
/map              Analyze codebase → ARCHITECTURE.md
/plan [N]         Create PLAN.md files for phase N
/sync-planning-to-gsd [N]  Project `.planning/` into `.gsd/`
/execute [N]      Wave-based execution with atomic commits
/verify [N]       Must-haves validation with proof
/debug [desc]     Systematic debugging (3-strike rule)

PROJECT SETUP
─────────────
/new-project      Deep questioning → SPEC.md
/new-milestone    Create milestone with phases
/complete-milestone   Archive completed milestone
/audit-milestone  Review milestone quality

PHASE MANAGEMENT
────────────────
/add-phase        Add phase to end of roadmap
/insert-phase     Insert phase (renumbers subsequent)
/remove-phase     Remove phase (with safety checks)
/discuss-phase    Clarify scope before planning
/research-phase   Deep technical research
/list-phase-assumptions   Surface planning assumptions
/plan-milestone-gaps      Create gap closure plans

NAVIGATION & STATE
──────────────────
/progress         Show current position in roadmap
/pause            Save state for session handoff
/resume           Restore from last session
/quick [id]       Execute a standalone task from `.planning/quick/`
/add-todo         Quick capture idea
/check-todos      List pending items

UTILITIES
─────────
/help             Show this help

───────────────────────────────────────────────────────

QUICK START
───────────
1. /plan 1                  → Create Phase 1 plans in `.planning/`
2. /research-phase 1        → Deepen technical context if needed
3. /sync-planning-to-gsd 1  → Project the plan into `.gsd/`
4. /execute 1               → Implement from `.gsd/`
5. /verify 1                → Confirm it works

───────────────────────────────────────────────────────

CORE RULES
──────────
🔒 Planning Lock     No code until `.planning/` docs are ready and synced
💾 State Persistence `.planning/STATE.md` is canonical; `.gsd/JOURNAL.md` holds execution notes
🧹 Context Hygiene   3 failures → state dump → fresh session
✅ Empirical Valid.  Proof required, no "it should work"

───────────────────────────────────────────────────────

📚 Docs: PROJECT_RULES.md, GSD-STYLE.md, .planning/README.md

───────────────────────────────────────────────────────
```

</process>
