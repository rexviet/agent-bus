---
phase: 5
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - src/adapters/process-runner.ts
  - test/fixtures/adapters/timeout-group-fixture.mjs
  - test/adapters/process-runner-monitor.test.ts
autonomous: true
requirements:
  - TIMEOUT-02
  - TIMEOUT-03
must_haves:
  truths:
    - "When timeout fires, SIGTERM is sent to the entire agent process group — shell wrappers and grandchild processes are terminated, not just the direct child"
    - "If the process group does not exit within 5 seconds of SIGTERM, SIGKILL is sent to the entire group"
    - "After SIGKILL, the partial result file is deleted before returning from runPreparedAdapterCommand"
    - "When the process exits normally before timeout, both timers are cleared — no dangling kills"
    - "Existing monitor tests (Tests 1–7) continue to pass — no regressions"
  artifacts:
    - path: "src/adapters/process-runner.ts"
      provides: "Process group kill + SIGKILL escalation"
      contains: "process.kill(-pid"
    - path: "test/fixtures/adapters/timeout-group-fixture.mjs"
      provides: "Grandchild process that ignores SIGTERM"
    - path: "test/adapters/process-runner-monitor.test.ts"
      provides: "Tests for TIMEOUT-02 and TIMEOUT-03"
  key_links:
    - from: "src/adapters/process-runner.ts"
      to: "child process group"
      via: "detached: true spawn + process.kill(-pid, signal)"
      pattern: "process\\.kill\\(-pid"
    - from: "sigTermHandle callback"
      to: "sigKillHandle"
      via: "nested setTimeout after SIGTERM fires"
      pattern: "sigKillHandle = setTimeout"
---
<!-- AUTO-GENERATED from .planning/phases/05-foundation-safety/05-02-PLAN.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->


<objective>
Replace the single-timer `child.kill("SIGTERM")` in `process-runner.ts` with a two-timer SIGTERM→SIGKILL escalation pattern targeting the full process group. Create a `timeout-group-fixture.mjs` that spawns a grandchild ignoring SIGTERM. Add integration tests for process group kill and SIGKILL escalation.

Purpose: TIMEOUT-02 and TIMEOUT-03. The current code sends SIGTERM only to the direct child — shell-wrapped agents (bash -c "opencode ...") leave grandchildren running. Process group kill is required.
Output: Updated `process-runner.ts`; new `timeout-group-fixture.mjs`; extended `process-runner-monitor.test.ts`.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.gsd/phases/5/CONTEXT.md
@.gsd/phases/5/RESEARCH.md

<interfaces>
<!-- Key contracts. No codebase exploration needed. -->

From src/adapters/process-runner.ts (current spawn + timeout block — lines 92-148):
```typescript
// Current spawn (NO detached):
const child = spawn(input.execution.command, [...input.execution.args], {
  cwd: input.execution.workingDirectory,
  env: { ...process.env, ...input.execution.environment },
  stdio: ["ignore", "pipe", "pipe"]
});

// Current timeout (kills direct child only — REPLACE THIS):
let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
if (monitor?.timeoutMs !== undefined) {
  timeoutHandle = setTimeout(() => {
    child.kill("SIGTERM");   // <-- kills direct child only, not process group
  }, monitor.timeoutMs);
}
// ... await child close event ...
if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
```

From src/adapters/process-runner.ts (rm already imported — line 4):
```typescript
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
```

ProcessMonitorCallbacks interface (lines 34-45):
```typescript
export interface ProcessMonitorCallbacks {
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly onStart?: (info: { pid: number; command: string; startedAt: Date }) => void;
  readonly onComplete?: (info: { pid: number; exitCode: number | null; signal: NodeJS.Signals | null; elapsedMs: number }) => void;
  readonly timeoutMs?: number;
}
```

RunPreparedAdapterCommandInput (lines 47-51):
```typescript
export interface RunPreparedAdapterCommandInput {
  readonly materializedRun: MaterializedAdapterRun;
  readonly execution: PreparedAdapterCommand;
  readonly monitor?: ProcessMonitorCallbacks;
}
// input.materializedRun.resultFilePath is the path to delete after SIGKILL
```

Existing fixture style (test/fixtures/adapters/monitor-fixture.mjs):
```javascript
// Controlled by env vars: FIXTURE_DELAY_MS, FIXTURE_EXIT_CODE, etc.
// Uses process.exit(exitCode) at end
```

Existing test style (test/adapters/process-runner-monitor.test.ts):
```typescript
const FIXTURE_PATH = path.resolve(process.cwd(), "test/fixtures/adapters/monitor-fixture.mjs");
function makeRun(dir: string) { return { runDirectory: dir, workPackagePath: ..., logFilePath: ..., resultFilePath: ... }; }
function makeExecution(env: Record<string, string> = {}, cwd?: string) {
  return { command: process.execPath, args: [FIXTURE_PATH], workingDirectory: cwd ?? process.cwd(), environment: env };
}
test("...", async () => { await withTempDir(async (dir) => { ... }); });
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create timeout-group-fixture.mjs (Wave 0 fixture)</name>
  <files>test/fixtures/adapters/timeout-group-fixture.mjs</files>
  <behavior>
    - When run, fixture spawns a grandchild process (`node -e "setTimeout(()=>{},60000)"` or similar) with `detached: true` — grandchild ignores SIGTERM and stays alive until SIGKILL
    - The fixture itself also ignores SIGTERM (installs `process.on("SIGTERM", () => {})`) so it doesn't exit on SIGTERM alone
    - Fixture exits when its grandchild is killed (i.e., only SIGKILL to the process group causes termination)
    - Controlled by env var `FIXTURE_GRANDCHILD_DELAY_MS` (default: 60000) — how long grandchild sleeps
  </behavior>
  <action>
    Create `test/fixtures/adapters/timeout-group-fixture.mjs` as an ES module (.mjs). The fixture must:

    1. Spawn a grandchild using `spawn` from `node:child_process` with `detached: true`. The grandchild command: `[process.execPath, "-e", "setTimeout(() => {}, 60000)"]`. The grandchild should NOT be `unref()`d — keep a reference so the fixture waits for it.
    2. Install a SIGTERM handler that does nothing: `process.on("SIGTERM", () => {})`. This makes the fixture survive SIGTERM, simulating a shell wrapper that ignores the signal.
    3. Wait for the grandchild to exit: `grandchild.once("close", () => process.exit(0))`.

    The result: the fixture and its grandchild are only terminated when SIGKILL reaches the entire process group (`process.kill(-fixturePid, "SIGKILL")`). SIGTERM to the direct fixture PID is absorbed.

    This is a plain `.mjs` file — no TypeScript, no compilation needed.
  </action>
  <verify>
    <automated>node test/fixtures/adapters/timeout-group-fixture.mjs &amp; sleep 0.1 &amp;&amp; kill $! 2>/dev/null; echo "fixture spawnable"</automated>
  </verify>
  <done>File exists at `test/fixtures/adapters/timeout-group-fixture.mjs`. It spawns a grandchild, absorbs SIGTERM, and only exits when process group is killed. Manually verifiable by running the fixture and observing it survives SIGTERM but dies on SIGKILL to the group.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Replace child.kill with process group kill + SIGKILL escalation in process-runner.ts; add tests</name>
  <files>src/adapters/process-runner.ts, test/adapters/process-runner-monitor.test.ts</files>
  <behavior>
    - Test 8: SIGTERM sent to process group — a fixture that ignores SIGTERM on direct child still exits when SIGKILL escalation fires (proves group kill works). Result signal is "SIGKILL". Elapsed < timeoutMs + SIGKILL_GRACE_MS + 500ms.
    - Test 9: SIGKILL fires after grace period — set `timeoutMs: 200`, run `timeout-group-fixture.mjs`, assert result.signal === "SIGKILL" and total elapsed < 200 + 5000 + 1000ms (within 6.2s).
    - Test 10: Result file is deleted after SIGKILL — write a partial JSON file to resultFilePath before running, confirm it is absent after runPreparedAdapterCommand returns with signal "SIGKILL".
    - Test 11: Normal exit clears both timers — process finishes in 0ms with timeoutMs: 10000; result.exitCode === 0, result.signal === null. (Existing Test 5 already covers this — add a comment reference, do NOT duplicate it unless needed.)
    - Existing tests 1–7 must still pass.
  </behavior>
  <action>
    **In `src/adapters/process-runner.ts`:**

    1. Add constant at module scope (top of file, after imports):
       ```typescript
       const SIGKILL_GRACE_MS = 5_000;
       ```

    2. Add `detached: true` to the `spawn()` call options. Do NOT add `child.unref()` — the parent must still await the child's close event.

    3. Replace the single-timer timeout block with the two-timer escalation pattern:
       ```typescript
       let sigTermHandle: ReturnType<typeof setTimeout> | undefined;
       let sigKillHandle: ReturnType<typeof setTimeout> | undefined;

       if (monitor?.timeoutMs !== undefined && child.pid !== undefined) {
         const pid = child.pid;
         sigTermHandle = setTimeout(() => {
           try { process.kill(-pid, "SIGTERM"); } catch { /* ESRCH */ }
           sigKillHandle = setTimeout(async () => {
             try { process.kill(-pid, "SIGKILL"); } catch { /* ESRCH */ }
             await rm(input.materializedRun.resultFilePath, { force: true });
           }, SIGKILL_GRACE_MS);
         }, monitor.timeoutMs);
       }
       ```

    4. After the `await` for the child's close event, clear both timers:
       ```typescript
       if (sigTermHandle !== undefined) clearTimeout(sigTermHandle);
       if (sigKillHandle !== undefined) clearTimeout(sigKillHandle);
       ```

    5. The `rm` import from `node:fs/promises` is already present on line 4 — no new import needed.

    NOTE: The existing `onStart` guard `child.pid !== undefined` is already present — apply the same guard to the timeout timer setup (already included above).

    **In `test/adapters/process-runner-monitor.test.ts`:**

    Add `const GROUP_FIXTURE_PATH = path.resolve(process.cwd(), "test/fixtures/adapters/timeout-group-fixture.mjs");` near the top.

    Add Tests 8, 9, and 10 as described in the behavior block. For Test 10: use `writeFile(materializedRun.resultFilePath, '{"status":"suc', "utf8")` before running to simulate a partial write; after `runPreparedAdapterCommand` returns, assert the file does not exist using `readFile(resultFilePath).then(() => assert.fail("file should be deleted")).catch((e) => assert.equal(e.code, "ENOENT"))`.

    Test timing for Tests 8/9: use timeoutMs: 200 so the full SIGTERM→SIGKILL cycle (200ms + 5000ms) completes in ~5.2s. Set test timeout if the runner allows, or simply allow the test to run for up to 8 seconds.
  </action>
  <verify>
    <automated>npm run build && node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js</automated>
  </verify>
  <done>All 10+ tests in process-runner-monitor.test.ts pass. `process-runner.ts` spawns with `detached: true`. Timeout block uses `process.kill(-pid, "SIGTERM")` and SIGKILL escalation after SIGKILL_GRACE_MS. Result file is deleted after SIGKILL. Both timer handles cleared on normal exit.</done>
</task>

</tasks>

<verification>
After both tasks:
- `npm run build` succeeds (TypeScript compiles)
- `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` — all tests pass, including new group-kill and SIGKILL escalation tests
- `npm test` — full suite passes (no regressions)
- `grep "process.kill(-pid" src/adapters/process-runner.ts` confirms replacement of `child.kill("SIGTERM")`
- `grep "SIGKILL_GRACE_MS" src/adapters/process-runner.ts` confirms constant defined
</verification>

<success_criteria>
- `src/adapters/process-runner.ts` spawns with `detached: true`
- Timeout uses `process.kill(-pid, "SIGTERM")` then `process.kill(-pid, "SIGKILL")` after 5000ms grace
- `SIGKILL_GRACE_MS = 5_000` constant defined at module scope
- Result file deleted after SIGKILL via `rm(resultFilePath, { force: true })`
- Both sigTermHandle and sigKillHandle cleared on normal process exit
- `process.kill` calls wrapped in try/catch for ESRCH
- All existing tests pass; new Tests 8–10 pass
</success_criteria>

<output>
After completion, create `.gsd/phases/5/02-SUMMARY.md` using the summary template.
</output>
