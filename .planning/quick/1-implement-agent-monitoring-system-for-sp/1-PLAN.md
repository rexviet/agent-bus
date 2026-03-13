---
phase: quick-monitoring
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/adapters/process-runner.ts
  - src/cli/output.ts
  - src/cli/worker-command.ts
  - test/adapters/process-runner-monitor.test.ts
autonomous: true
requirements: [MON-01, MON-02, MON-03, MON-04]
must_haves:
  truths:
    - "Operator sees agent stdout/stderr in realtime while agent runs"
    - "Operator sees how long agent has been running"
    - "Agent crash/timeout is detected and reported clearly"
    - "Full log remains available at logFilePath after agent finishes"
  artifacts:
    - path: "src/adapters/process-runner.ts"
      provides: "Process monitoring with timeout, streaming, elapsed time"
    - path: "src/cli/output.ts"
      provides: "Realtime output writing helpers for agent execution"
    - path: "src/cli/worker-command.ts"
      provides: "Wiring of process monitor callbacks to terminal output"
  key_links:
    - from: "src/adapters/process-runner.ts"
      to: "src/cli/worker-command.ts"
      via: "ProcessMonitorCallbacks option passed through adapter-worker"
      pattern: "onStdout|onStderr|onStart|onTimeout"
---

<objective>
Add agent process monitoring to the adapter runner so operators get realtime visibility into spawned agent processes.

Purpose: Currently when Agent Bus spawns an agent (e.g. Gemini CLI), the operator is blind -- no output, no status, no error feedback. This makes debugging impossible and operations opaque.

Output: Enhanced process-runner with opt-in monitoring callbacks (stdout/stderr streaming, elapsed time tracking, timeout enforcement), CLI output helpers, and wiring in worker-command.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/adapters/process-runner.ts
@src/cli/output.ts
@src/cli/worker-command.ts
@src/daemon/adapter-worker.ts

<interfaces>
<!-- Key types the executor needs -->

From src/adapters/process-runner.ts:
```typescript
export interface RunPreparedAdapterCommandInput {
  readonly materializedRun: MaterializedAdapterRun;
  readonly execution: PreparedAdapterCommand;
}

export interface AdapterProcessRunResult {
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly result?: AdapterResultEnvelope;
}
```

From src/cli/output.ts:
```typescript
export interface WritableTextStream {
  write(chunk: string): boolean;
}
```

From src/daemon/adapter-worker.ts:
```typescript
// runPreparedAdapterCommand is called at line 390
// The input is constructed inline -- only materializedRun and execution are passed
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add process monitoring to process-runner with timeout support</name>
  <files>src/adapters/process-runner.ts, test/adapters/process-runner-monitor.test.ts</files>
  <behavior>
    - Test 1: When no monitor options passed, runPreparedAdapterCommand behaves identically to current (backwards compatible) -- stdout/stderr only go to log file
    - Test 2: When onStdout callback provided, each stdout chunk is delivered to callback AND still written to log file
    - Test 3: When onStderr callback provided, each stderr chunk is delivered to callback AND still written to log file
    - Test 4: When timeoutMs provided and process exceeds it, process is killed (SIGTERM) and result has signal="SIGTERM"
    - Test 5: When timeoutMs provided and process completes within limit, no kill occurs
    - Test 6: onStart callback is called with { pid, command, startedAt } when process spawns
    - Test 7: onComplete callback is called with { pid, exitCode, signal, elapsedMs } when process ends
  </behavior>
  <action>
1. Define a new optional interface in process-runner.ts:

```typescript
export interface ProcessMonitorCallbacks {
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly onStart?: (info: { pid: number; command: string; startedAt: Date }) => void;
  readonly onComplete?: (info: { pid: number; exitCode: number | null; signal: NodeJS.Signals | null; elapsedMs: number }) => void;
  readonly timeoutMs?: number;
}
```

2. Extend `RunPreparedAdapterCommandInput` with an optional `monitor?: ProcessMonitorCallbacks` field.

3. In `runPreparedAdapterCommand()`:
   - After spawn, if `monitor.onStart` exists, call it with pid, command string, and current timestamp.
   - Add `child.stdout?.on("data", chunk => ...)` listeners that call `monitor.onStdout?.(chunk)` in addition to the existing pipe to logStream. Replace the `.pipe()` calls with manual `on("data")` handlers that write to both logStream and the callback.
   - If `monitor.timeoutMs` is set, create a `setTimeout` that calls `child.kill("SIGTERM")`. Clear it on process close.
   - After process closes, if `monitor.onComplete` exists, call it with pid, exitCode, signal, and elapsed time (Date.now() - startTime).

4. CRITICAL: When no `monitor` is provided, behavior must be identical to current code. The `on("data")` approach still pipes to logStream the same way. Default path: just pipe to logStream as before.

5. Write tests using a small node script fixture (similar to existing test/fixtures/adapters/) that writes to stdout/stderr and optionally sleeps for timeout testing. Use `node:test` and `node:assert/strict`.
  </action>
  <verify>
    <automated>npm run build && node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js</automated>
  </verify>
  <done>ProcessMonitorCallbacks interface exported, runPreparedAdapterCommand accepts optional monitor parameter, all 7 behavior tests pass, existing 66/66 tests still pass (npm test)</done>
</task>

<task type="auto">
  <name>Task 2: Add CLI output helpers and wire monitoring into worker-command</name>
  <files>src/cli/output.ts, src/cli/worker-command.ts, src/daemon/adapter-worker.ts</files>
  <action>
1. Add output helpers in `src/cli/output.ts`:

```typescript
export function writeAgentOutputLine(stream: WritableTextStream, agentId: string, source: "stdout" | "stderr", line: string): void {
  // Format: "  [agent-id:stdout] line content"
  // Use 2-space indent to visually nest under worker status
  stream.write(`  [${agentId}:${source}] ${line}\n`);
}

export function writeAgentStartedText(stream: WritableTextStream, info: {
  agentId: string; pid: number; command: string;
}): void {
  // "Agent started agent-id (pid=12345, command=gemini ...)"
  writeLine(stream, `Agent started ${info.agentId} (pid=${info.pid}, command=${info.command})`);
}

export function writeAgentCompletedText(stream: WritableTextStream, info: {
  agentId: string; pid: number; exitCode: number | null; signal: NodeJS.Signals | null; elapsedMs: number;
}): void {
  const elapsed = (info.elapsedMs / 1000).toFixed(1);
  const exitInfo = info.signal ? `signal=${info.signal}` : `exitCode=${info.exitCode}`;
  writeLine(stream, `Agent completed ${info.agentId} (pid=${info.pid}, ${exitInfo}, elapsed=${elapsed}s)`);
}
```

2. Thread monitor through adapter-worker. In `src/daemon/adapter-worker.ts`:
   - Add an optional `monitor?: ProcessMonitorCallbacks` field to `AdapterWorkerOptions`. Import `ProcessMonitorCallbacks` from process-runner.
   - When calling `runPreparedAdapterCommand()` (line ~390), pass `monitor: options.monitor` in the input object.
   - This is additive only -- when monitor is undefined (as in all existing tests), behavior is unchanged.

3. In `src/cli/worker-command.ts`:
   - Add a `--verbose` flag (or `-v`) to the worker command. Add to `flagsWithoutValues` set.
   - When `--verbose` is set, construct a `ProcessMonitorCallbacks` object that:
     - `onStdout`: splits buffer on newlines, calls `writeAgentOutputLine(io.stdout, agentId, "stdout", line)` for each line. Buffer partial lines (no trailing newline) to avoid splitting mid-line.
     - `onStderr`: same but with "stderr" source.
     - `onStart`: calls `writeAgentStartedText(io.stdout, ...)`.
     - `onComplete`: calls `writeAgentCompletedText(io.stdout, ...)`.
   - Problem: The agentId is not known until a delivery is claimed. Solution: pass the monitor callbacks through to daemon via a new optional parameter on `daemon.runWorkerIteration()`. The daemon's `startDaemon` function returns `runWorkerIteration(workerId, leaseDurationMs, retryDelayMs)` -- add an optional 4th parameter `monitor?: ProcessMonitorCallbacks`. In `src/daemon/index.ts`, thread this to the adapter worker options.
   - Alternative simpler approach: Since worker-command controls the daemon instance, pass the monitor at `startDaemon` time or via a setter. BUT since the agentId changes per delivery, the cleanest approach is to pass monitor on each `runWorkerIteration` call.
   - For the agentId in output callbacks: the callbacks capture a mutable `currentAgentId` variable that gets set after claim. Since `onStart` fires after spawn (which is after claim), the agentId will be available. Actually simpler: just use "agent" as a generic label in the callbacks since the worker already prints agentId in the execution result. The streaming output's purpose is visibility, not identification.
   - SIMPLEST approach that avoids touching daemon interface: Pass monitor through `AdapterWorkerOptions` when creating the worker. In `worker-command.ts`, the daemon is created once. The `daemon.runWorkerIteration` internally creates adapter worker each time. So the monitor needs to be set at daemon creation time.
   - ACTUAL simplest: In `src/daemon/index.ts`, add `monitor?: ProcessMonitorCallbacks` to `StartDaemonInput`. Pass it to `createAdapterWorker` in the options. This is a single additive field.

4. Read `src/daemon/index.ts` to confirm the startDaemon interface and where createAdapterWorker is called. Thread the monitor option through.

IMPORTANT: Do NOT change any existing function signatures in a breaking way. All additions are optional fields on existing interfaces. The `--verbose` flag defaults to off, meaning default behavior is completely unchanged.
  </action>
  <verify>
    <automated>npm run build && npm test</automated>
  </verify>
  <done>
    - `--verbose` flag on worker command enables realtime agent output in terminal
    - Agent start/complete lifecycle messages shown with pid, command, elapsed time
    - stdout/stderr lines prefixed with source label and indented under worker output
    - Without `--verbose`, behavior is identical to current (no output during execution)
    - All 66 existing tests pass plus new process-runner-monitor tests
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Agent process monitoring with realtime output streaming, elapsed time tracking, and timeout support. Activated via `--verbose` flag on worker command.</what-built>
  <how-to-verify>
    1. Build: `npm run build`
    2. Run all tests: `npm test` -- expect all 66+ tests pass
    3. Verify new tests: `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js`
    4. (Optional, requires a configured agent-bus.yaml) Run worker with verbose: `npm run start -- worker --verbose --once`
    5. Verify that without --verbose, `npm run start -- worker --once` behaves exactly as before
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- `npm test` passes all existing 66 tests (no regressions)
- New process-runner-monitor tests pass
- `npm run typecheck` passes with no errors
- `--verbose` flag is recognized by worker command
- Without `--verbose`, zero behavioral change
</verification>

<success_criteria>
1. Operator can see agent stdout/stderr in realtime when using `--verbose`
2. Operator sees agent start (pid, command) and completion (exit code, elapsed time)
3. Agent timeout is enforced when `timeoutMs` is configured
4. All logs still written to logFilePath (dual output, not either/or)
5. All existing tests pass unchanged
6. New monitoring is fully opt-in -- zero impact without `--verbose`
</success_criteria>

<output>
After completion, create `.planning/quick/1-implement-agent-monitoring-system-for-sp/1-SUMMARY.md`
</output>
