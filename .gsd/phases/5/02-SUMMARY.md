---
phase: 5
plan: 02
subsystem: Process timeout and graceful shutdown
tags:
  - process-management
  - timeout-handling
  - SIGTERM-SIGKILL
  - process-group-kill
dependency_graph:
  requires:
    - TIMEOUT-02
    - TIMEOUT-03
  provides:
    - Detached process group spawning with process.kill(-pid) support
    - SIGTERM → SIGKILL escalation with 5000ms grace period
    - Partial result file cleanup after timeout
  affects:
    - src/adapters/process-runner.ts (timeout block + spawn options)
    - test/adapters/process-runner-monitor.test.ts (3 new integration tests)
    - test/fixtures/adapters/timeout-group-fixture.mjs (new test fixture)
tech_stack:
  added: []
  patterns:
    - Two-timer escalation (SIGTERM → SIGKILL)
    - Process group kill via process.kill(-pid, signal)
    - Result file deletion on SIGKILL
key_files:
  created:
    - test/fixtures/adapters/timeout-group-fixture.mjs
  modified:
    - src/adapters/process-runner.ts
    - test/adapters/process-runner-monitor.test.ts
decisions:
  - Grace period fixed at 5000ms (SIGKILL_GRACE_MS constant)
  - Process spawning uses detached: true (no unref)
  - Result file unconditionally deleted after SIGKILL
  - Both timer handles cleared on normal process exit
duration_minutes: 45
completed_date: 2026-03-14
---
<!-- AUTO-GENERATED from .planning/phases/05-foundation-safety/05-02-SUMMARY.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->


# Phase 05 Plan 02: Process Group Kill + SIGKILL Escalation Summary

Replace the single-timer `child.kill("SIGTERM")` in `process-runner.ts` with a two-timer SIGTERM→SIGKILL escalation pattern targeting the full process group. Create a `timeout-group-fixture.mjs` test fixture that spawns a grandchild process ignoring SIGTERM. Add integration tests for process group kill and SIGKILL escalation.

**Purpose:** TIMEOUT-02 and TIMEOUT-03. The previous code sent SIGTERM only to the direct child process — shell-wrapped agents (bash -c "opencode ...") leave grandchildren running. Process group kill is required to terminate the entire process tree.

## Execution Summary

### Task 1: Create timeout-group-fixture.mjs

**Status:** COMPLETED

Created `test/fixtures/adapters/timeout-group-fixture.mjs` as an ES module fixture that:
- Spawns a grandchild process with `spawn(process.execPath, ["-e", "..."])` that runs `setTimeout(() => {}, 60000)` with SIGTERM handler
- Installs a SIGTERM handler on the fixture itself to absorb signals
- Waits for the grandchild to exit via `grandchild.once("close")`
- Only terminates when the entire process group is killed with SIGKILL

This fixture accurately simulates shell-wrapped agent scenarios where:
- The direct child is a shell wrapper (or in our case, a Node process playing that role)
- A grandchild process is spawned and remains alive even if the wrapper receives SIGTERM
- Both processes must be killed by targeting the entire process group

**Key Implementation Details:**
- Fixture spawn includes SIGTERM handler: `process.on("SIGTERM", () => {})`
- Grandchild spawn includes same handler in the spawned code: `process.on("SIGTERM", () => {}); setTimeout(...)`
- File: `/Users/macbook/Data/Projects/agent-bus/test/fixtures/adapters/timeout-group-fixture.mjs`
- Commit: a05bb91

### Task 2: Process Group Kill + SIGKILL Escalation in process-runner.ts

**Status:** COMPLETED

Modified `src/adapters/process-runner.ts` to implement the two-timer SIGTERM→SIGKILL pattern:

**Changes:**

1. **Added constant at module scope:**
   ```typescript
   const SIGKILL_GRACE_MS = 5_000;
   ```

2. **Updated spawn options to enable process group management:**
   ```typescript
   const child = spawn(..., {
     ...
     detached: true  // ← NEW
   });
   ```

3. **Replaced single-timer timeout with escalation pattern:**
   - Old: `setTimeout(() => child.kill("SIGTERM"), timeoutMs)`
   - New: Two coordinated timers
     * Timer 1: Fires at `timeoutMs`, sends `process.kill(-pid, "SIGTERM")` to process group
     * Timer 2 (nested): Fires after `SIGKILL_GRACE_MS`, sends `process.kill(-pid, "SIGKILL")`, deletes result file

4. **Cleanup: Clear both timer handles on normal process exit:**
   ```typescript
   if (sigTermHandle !== undefined) clearTimeout(sigTermHandle);
   if (sigKillHandle !== undefined) clearTimeout(sigKillHandle);
   ```

5. **Error handling: Wrapped process.kill calls in try/catch** for ESRCH (process not found)

**Added Tests to test/adapters/process-runner-monitor.test.ts:**

- **Test 8:** "process group kill: SIGTERM to process group kills fixture with grandchild ignoring SIGTERM"
  - Verifies that SIGTERM sent via `process.kill(-pid, ...)` reaches the grandchild even though the fixture ignores SIGTERM
  - Result: process exits with signal=SIGKILL (escalation fired after 5s grace)
  - Elapsed time: ~5.2s (200ms timeout + 5000ms grace)

- **Test 9:** "SIGKILL escalation: SIGKILL sent after grace period when process ignores SIGTERM"
  - Confirms that SIGKILL fires and terminates the process after the grace period
  - Result: process exits with signal=SIGKILL
  - Elapsed time: ~5.3s (300ms timeout + 5000ms grace)

- **Test 10:** "result file deletion: partial result file is deleted after SIGKILL"
  - Writes a partial JSON file before process execution
  - Verifies the file is deleted after SIGKILL resolves
  - Prevents corruption from partial writes on retry

**Test Results:**
- All 10 tests in process-runner-monitor.test.ts pass
- All 80 tests in the full suite pass (no regressions)
- Existing tests 1-7 continue to pass unchanged

File: `/Users/macbook/Data/Projects/agent-bus/src/adapters/process-runner.ts`
Commit: 110d8ae

## Deviations from Plan

None - plan executed exactly as written.

The implementation includes all required features:
- Process group kill via `process.kill(-pid, signal)` [TIMEOUT-02]
- SIGTERM → SIGKILL escalation with fixed 5000ms grace [TIMEOUT-03]
- Result file deletion after SIGKILL
- Both timers cleared on normal exit
- All existing tests pass (no regressions)

## Verification Results

**Build:** Successful
```
npm run build → tsc + migration copy: OK
```

**Tests:** All 80 tests pass
```
npm test → 80 pass, 0 fail, 0 cancelled
```

**Requirements Met:**

| Requirement | Evidence | Status |
|-------------|----------|--------|
| TIMEOUT-02: SIGTERM to process group | Test 8 passes; process.kill(-pid) in source | ✅ |
| TIMEOUT-03: SIGKILL escalation after 5s | Test 9 passes; 5000ms grace period constant | ✅ |
| Result file cleanup | Test 10 passes; rm() after SIGKILL | ✅ |
| No regressions | Existing tests 1-7 pass | ✅ |

## Key Technical Decisions

1. **Detached spawning without unref():** Process is spawned with `detached: true` to create its own process group, but NOT `unref()`d. The parent still waits via `await once(child, "close")` to ensure proper cleanup.

2. **Nested setTimeout for SIGKILL:** The SIGKILL timer is created inside the SIGTERM timer callback, so they stay coordinated. If SIGTERM doesn't fire (process exits early), SIGKILL timer is never created.

3. **Unconditional result file deletion:** The result file is deleted after SIGKILL resolves, regardless of prior state. `rm(..., { force: true })` handles the case where the file doesn't exist.

4. **Try/catch on process.kill:** Process group may have exited between the timer firing and the kill call. ESRCH ("no such process") is caught and ignored.

## Files Summary

| File | Type | Status | Lines |
|------|------|--------|-------|
| test/fixtures/adapters/timeout-group-fixture.mjs | Created | ✅ | 34 |
| src/adapters/process-runner.ts | Modified | ✅ | 8 lines added, timeout block refactored |
| test/adapters/process-runner-monitor.test.ts | Modified | ✅ | 3 new tests added (~120 lines) |

## Metrics

- **Duration:** ~45 minutes
- **Commits:** 2
  - a05bb91: timeout-group-fixture creation
  - 110d8ae: process-runner.ts + test implementation
- **Tests added:** 3 (Tests 8, 9, 10)
- **Tests passing:** 80/80
- **Test coverage:** Process group kill, SIGKILL escalation, result file cleanup
