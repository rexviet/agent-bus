---
phase: 5
plan: 3
type: execute
wave: 2
depends_on:
  - 05-01
  - 05-02
files_modified:
  - src/daemon/adapter-worker.ts
  - test/daemon/adapter-worker.test.ts
autonomous: true
requirements:
  - TIMEOUT-04
must_haves:
  truths:
    - "When an agent times out, its delivery is scheduled for retry (retry_scheduled) not dead-lettered"
    - "The per-delivery monitor uses agent.timeout (seconds) converted to timeoutMs (ms) — different agents can have different timeouts"
    - "An agent without a `timeout` field in the manifest runs without any timeout applied"
    - "A delivery that times out and has exhausted max retries is dead-lettered (normal retry exhaustion path)"
  artifacts:
    - path: "src/daemon/adapter-worker.ts"
      provides: "Per-delivery ProcessMonitorCallbacks built from agent.timeout"
      contains: "agent.timeout * 1000"
  key_links:
    - from: "src/daemon/adapter-worker.ts (runIteration)"
      to: "runPreparedAdapterCommand"
      via: "perDeliveryMonitor built from agent.timeout"
      pattern: "agent\\.timeout.*1000"
    - from: "timeout signal exit"
      to: "deliveryService.fail()"
      via: "existing !processResult.result + signal branch"
      pattern: "deliveryService\\.fail"
---
<!-- AUTO-GENERATED from .planning/phases/05-foundation-safety/05-03-PLAN.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->


<objective>
Wire `agent.timeout` from the manifest into per-delivery `ProcessMonitorCallbacks` inside `adapter-worker.ts`, and add an integration test that confirms a timed-out delivery is scheduled for retry rather than dead-lettered.

Purpose: TIMEOUT-04. The current code passes a single global `options.monitor` to all deliveries. Per-agent timeout requires building a delivery-specific monitor from `agent.timeout * 1000` inside `runIteration`. The retry routing already works for signal exits — TIMEOUT-04 is satisfied as long as the result file is deleted (Plan 02) and `perDeliveryMonitor` is constructed correctly.
Output: Updated `adapter-worker.ts` with per-delivery monitor construction; extended `adapter-worker.test.ts` with timeout-retry test.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.gsd/phases/5/CONTEXT.md
@.gsd/phases/5/RESEARCH.md
@.gsd/phases/5/01-SUMMARY.md
@.gsd/phases/5/02-SUMMARY.md

<interfaces>
<!-- Key contracts from Plans 01 and 02 that this plan builds on. -->

From src/config/manifest-schema.ts (after Plan 01):
```typescript
// AgentBusManifest["agents"][number] now has:
//   timeout?: number   (seconds, optional, positive)
// agent.timeout === undefined means no timeout configured
```

From src/adapters/process-runner.ts (after Plan 02):
```typescript
// ProcessMonitorCallbacks.timeoutMs triggers SIGTERM→SIGKILL escalation
// If monitor is undefined or timeoutMs is undefined — no timeout, process runs until exit
export interface ProcessMonitorCallbacks {
  readonly timeoutMs?: number;
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly onStart?: (info: { pid: number; command: string; startedAt: Date }) => void;
  readonly onComplete?: (info: { pid: number; exitCode: number | null; signal: NodeJS.Signals | null; elapsedMs: number }) => void;
}
```

From src/daemon/adapter-worker.ts (current runIteration — lines 325-402):
```typescript
// Current: passes global options.monitor to all deliveries (line 401)
...(options.monitor ? { monitor: options.monitor } : {})

// Target: build per-delivery monitor inside runIteration after agent is resolved
const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);
// ... agent.timeout is now number | undefined ...

const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
  agent.timeout !== undefined
    ? { ...(options.monitor ?? {}), timeoutMs: agent.timeout * 1000 }
    : options.monitor;

// Then pass perDeliveryMonitor instead of options.monitor:
...(perDeliveryMonitor ? { monitor: perDeliveryMonitor } : {})
```

Retry routing (adapter-worker.ts lines 404-433 — NO CHANGE NEEDED):
```typescript
// Signal exit (SIGTERM or SIGKILL) with no result → processResult.result is undefined
// → enters the !processResult.result branch
// → processResult.signal !== null → calls deliveryService.fail() (retry path)
// → TIMEOUT-04 satisfied as long as result file is deleted before returning from process-runner
```

From test/daemon/adapter-worker.test.ts (test infrastructure):
```typescript
// Tests use startDaemon() + daemon.runWorkerIteration("worker-1", leaseDurationMs)
// Manifest passed as inline YAML text with agent command pointing to fixture .mjs files
// Available fixtures: success-adapter.mjs, fail-adapter.mjs
// New fixture needed: a timeout adapter that hangs (use monitor-fixture.mjs with FIXTURE_DELAY_MS=9999)
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire per-delivery monitor in adapter-worker.ts; add timeout-retry integration test</name>
  <files>src/daemon/adapter-worker.ts, test/daemon/adapter-worker.test.ts</files>
  <behavior>
    - Test A: Agent with `timeout: 1` (1 second) runs a command that sleeps 30s. After runWorkerIteration returns, delivery status is NOT "dead_letter" — it is "retry_scheduled". (Note: delivery status after fail() is "retry_scheduled" in the delivery state machine.)
    - Test B: Agent without `timeout` field in manifest runs a short-lived command — delivery completes normally with status "completed" (no regression).
    - Test C (type check only, no runtime test): When `agent.timeout` is 30, `perDeliveryMonitor.timeoutMs` equals 30000 (seconds → ms conversion). Verify via TypeScript — not a runtime assertion needed in test file, but implementation must perform the multiplication.
  </behavior>
  <action>
    **In `src/daemon/adapter-worker.ts`:**

    Inside `runIteration`, after the line `const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);` (approximately line 359), add per-delivery monitor construction:

    ```typescript
    const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
      agent.timeout !== undefined
        ? { ...(options.monitor ?? {}), timeoutMs: agent.timeout * 1000 }
        : options.monitor;
    ```

    Then replace line ~401 (`...(options.monitor ? { monitor: options.monitor } : {})`) with:
    ```typescript
    ...(perDeliveryMonitor ? { monitor: perDeliveryMonitor } : {})
    ```

    That is the only change needed in adapter-worker.ts. The retry routing (deliveryService.fail() for signal exits) already exists and does not need modification — Plan 02's result file deletion ensures the `!processResult.result` branch is taken for timed-out deliveries.

    **In `test/daemon/adapter-worker.test.ts`:**

    Add a new test: "runWorkerIteration schedules retry when agent times out". Use the `monitor-fixture.mjs` path as the agent command with env var `FIXTURE_DELAY_MS=5000`. Set `timeout: 1` (1 second) in the agent manifest YAML. Call `daemon.runWorkerIteration("worker-1", 60_000)` — this will take ~1s (timeout) + ~5s (SIGKILL grace) = ~6s. After it returns, assert:
    - `execution` is not null
    - `execution.status === "process_error"` (the adapter-worker status for signal exits)
    - `execution.delivery.status === "retry_scheduled"`

    Use `withTempRepo` helper (already defined in the file). The manifest YAML format to use for the timing-out agent:
    ```yaml
    agents:
      - id: slow_agent
        runtime: codex
        timeout: 1
        command: ["${process.execPath}", "${monitorFixturePath}", "--"]
    ```
    where `FIXTURE_DELAY_MS` is passed via the `environment` block in YAML:
    ```yaml
        environment:
          FIXTURE_DELAY_MS: "5000"
    ```

    NOTE: The test will take ~6 seconds (1s timeout + 5s SIGKILL grace). This is acceptable per VALIDATION.md (full suite ~15s). Do not use a short SIGKILL grace for tests — the production constant is 5000ms.

    Import `monitorFixturePath` similarly to how `successAdapterPath` is defined at the top of the test file.
  </action>
  <verify>
    <automated>npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js</automated>
  </verify>
  <done>New test passes: timed-out delivery has status "retry_scheduled", not "dead_letter". Existing adapter-worker tests pass. TypeScript compiles without error (`npm run typecheck`).</done>
</task>

</tasks>

<verification>
After the task:
- `npm run build && npm run typecheck` — no TypeScript errors
- `node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` — all tests pass including new timeout-retry test
- `npm test` — full suite green
- `grep "agent\.timeout \* 1000" src/daemon/adapter-worker.ts` — confirms seconds-to-ms conversion present
- `grep "perDeliveryMonitor" src/daemon/adapter-worker.ts` — confirms per-delivery monitor construction
</verification>

<success_criteria>
- `adapter-worker.ts` constructs `perDeliveryMonitor` from `agent.timeout * 1000` when timeout is set
- Agent without `timeout` field falls back to `options.monitor` (no timeout applied)
- Timed-out delivery (SIGKILL signal exit, no result file) routes to `deliveryService.fail()` — status becomes "retry_scheduled"
- Full `npm test` suite passes
- All four requirements (TIMEOUT-01 through TIMEOUT-04) satisfied across Plans 01–03
</success_criteria>

<output>
After completion, create `.gsd/phases/5/03-SUMMARY.md` using the summary template.
</output>
