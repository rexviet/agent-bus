---
trigger: always_on
---

# Git Workflow Rules for AI Agents

## Purpose

This document defines the mandatory Git workflow that all AI Agents must strictly follow when working on this repository.

These rules are **not optional**. Any violation is considered a workflow failure.

---

# 1. Branching Rules (MANDATORY)

## 1.1 Always Create a New Branch

Before starting **any** of the following:

- A new feature
- A task
- A bug fix (including:
  - Bugs reported by the user
  - Bugs found during code review
  - Bugs found during CI)

The agent **MUST create a new branch**.

## 1.2 Branch Naming Convention

Use clear and descriptive names:

```
feature/<short-description>
fix/<short-description>
hotfix/<short-description>
refactor/<short-description>
```

Examples:

```
feature/user-authentication
fix/login-null-pointer
hotfix/ci-pipeline-failure
```

❌ Never commit directly to `main` or `master`.  
❌ Never reuse old branches for new work.

---

# 2. Pull Request Process (MANDATORY)

## 2.1 After Completing Work

When implementation is finished:

1. Commit all changes
2. Push the branch to remote
3. Create a Pull Request (PR) immediately

The PR must include:

- Clear title
- Description of changes
- What problem it solves
- Any relevant context

---

# 3. PR Monitoring & CI Handling

After creating the PR:

## 3.1 Continuous Monitoring

A subagent must:

- Monitor PR status
- Monitor CI pipeline (use gh cli)
- Monitor merge conflicts

## 3.2 If CI Fails

If CI fails:

- The agent must immediately fix the issue
- Push the fix
- Wait for CI to run again
- Repeat until CI passes

## 3.3 If Merge Conflicts Occur

If conflicts appear:

- Rebase or merge latest `main`
- Resolve conflicts properly
- Push updated branch
- Ensure CI passes again

This loop continues until:

- ✅ No conflicts  
- ✅ CI is fully green  

---

# 4. Review & Merge Policy

## 4.1 NEVER Auto-Merge

The agent is **strictly forbidden** from merging the PR without explicit human approval.

Even if:

- CI passes
- All checks are green
- No conflicts exist

The agent must:

1. Notify the user
2. Wait for approval

## 4.2 Merge Only With Explicit Permission

Merge is allowed only if the user clearly says:

- "Approved"
- "You can merge"
- "Merge it"
- Or equivalent explicit authorization

No assumptions allowed.

---

# 5. Post-Merge Actions (MANDATORY)

Immediately after merge:

1. Sync local repository:

```
git checkout main
git pull origin main
```

2. Delete local branch
3. Delete remote branch (if required by policy)

The agent must ensure the working environment is clean before starting any new task.

---

# 6. Strict Prohibitions

The agent must NEVER:

- Commit directly to `main`
- Merge without approval
- Ignore CI failures
- Leave PRs unattended
- Start work without creating a branch
- Continue working on an outdated branch after merge

---

# 7. Workflow Summary

For every task:

1. Create new branch
2. Implement changes
3. Push branch
4. Create PR
5. Monitor CI & conflicts
6. Fix until CI passes
7. Notify user
8. Wait for approval
9. Merge only after approval
10. Sync local immediately

---

# Enforcement

Failure to follow this workflow is considered a protocol violation.

All AI Agents must treat this document as a hard operational constraint.