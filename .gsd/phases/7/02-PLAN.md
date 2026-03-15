---
phase: 7
plan: 2
type: execute
wave: 2
depends_on:
  - 07-01
files_modified:
  - src/cli/worker-command.ts
  - src/daemon/adapter-worker.ts
  - test/cli/worker-command.test.ts
autonomous: true
requirements:
  - WORKER-01
  - WORKER-02
  - WORKER-03

must_haves:
  truths:
    - "Operator starts daemon with --concurrency 4 and up to 4 agent processes run simultaneously"
    - "Daemon started without --concurrency defaults to concurrency 1 with identical behavior to pre-Phase-7"
    - "On SIGINT/SIGTERM, daemon stops claiming and waits for all in-flight deliveries to complete"
    - "If drain timeout expires, in-flight child processes receive SIGTERM then SIGKILL after 5s grace"
    - "Worker stopped text includes drain count of in-flight deliveries at shutdown"
    - "Only one slot calls claim() at a time (mutex serialization)"
    - "In-flight count check prevents over-committing beyond concurrency limit"
    - "Worker identity uses slot suffix format: worker-{pid}/0, worker-{pid}/1"
    - "Lease conflict is logged at warn level with deliveryId when runWorkerIteration returns null due to conflict"
  artifacts:
    - path: "src/cli/worker-command.ts"
      provides: "Concurrent slot-loop pool replacing sequential while-loop, drain timeout with SIGTERM->SIGKILL escalation, PID tracking for force-kill"
      contains: "runSlot"
    - path: "src/daemon/adapter-worker.ts"
      provides: "runIteration returns PID handle or exposes forceKillInFlight hook for drain escalation, lease conflict warn log"
      contains: "lease.conflict"
    - path: "test/cli/worker-command.test.ts"
      provides: "Integration tests for concurrent execution, default concurrency, drain behavior, lease conflict warning"
      contains: "concurrency"
  key_links:
    - from: "src/cli/worker-command.ts"
      to: "src/daemon/adapter-worker.ts"
      via: "daemon.runWorkerIteration called from each slot loop"
      pattern: "runWorkerIteration.*slotWorkerId"
    - from: "src/cli/worker-command.ts"
      to: "src/cli/worker-command.ts"
      via: "claimMutex.run wraps claim path in runSlot"
      pattern: "claimMutex\\.run"
    - from: "src/cli/worker-command.ts"
      to: "src/cli/output.ts"
      via: "writeWorkerStoppedText with drainedDeliveries count"
      pattern: "drainedDeliveries"
    - from: "src/cli/worker-command.ts"
      to: "src/daemon/adapter-worker.ts"
      via: "drain timeout escalation: SIGTERM then SIGKILL on tracked child PIDs"
      pattern: "SIGKILL.*forceKill"
    - from: "src/daemon/adapter-worker.ts"
      to: "src/daemon/logger.ts"
      via: "logger.warn on lease conflict with event lease.conflict"
      pattern: "lease\\.conflict"
---
<!-- AUTO-GENERATED from .planning/phases/07-concurrent-workers/07-02-PLAN.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 76bcca33c32e26781a430ca82343e388a2e598c147e1dad92fa34e41d74158b1. Edit the source file, not this projection. -->


<objective>
Replace the sequential while-loop in worker-command.ts with a concurrent slot-loop pool where N independent slots each claim and execute deliveries in parallel, guarded by a claim mutex and in-flight count check. Implement graceful drain on SIGINT/SIGTERM with configurable drain timeout that escalates to SIGTERM -> 5s grace -> SIGKILL on in-flight child processes (per CONTEXT.md locked decision). Add lease conflict warn logging. Add integration tests for concurrent execution, default concurrency, drain behavior, and lease conflict warning.

Purpose: Delivers the core concurrency capability (WORKER-01/02) and graceful shutdown (WORKER-03) that operators need for production workloads.
Output: Working concurrent worker pool with drain logic, force-kill escalation, and integration tests.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.gsd/SPEC.md
@.gsd/ROADMAP.md
@.gsd/STATE.md
@.gsd/phases/7/CONTEXT.md
@.gsd/phases/7/RESEARCH.md
@.gsd/phases/7/VALIDATION.md
@.gsd/phases/7/01-SUMMARY.md

<interfaces>
<!-- From Plan 01 outputs -- executor should read 07-01-SUMMARY.md for exact implementation details -->

From src/cli/worker-command.ts (after Plan 01):
```typescript
// New utility from Plan 01:
export function createMutex(): {
  run<T>(fn: () => Promise<T>): Promise<T>;
};

// New local variables from Plan 01:
const concurrency: number;            // parsed from --concurrency, default 1
const drainTimeoutMs: number;         // parsed from --drain-timeout-ms, default 30000
const verboseMonitorFactory: ((agentId: string) => ProcessMonitorCallbacks) | undefined;

// Existing helpers:
function createStopController(): {
  readonly requested: boolean;
  readonly reason: string;
  request(nextReason: string): void;
  waitForStop(): Promise<void>;
};
function sleep(milliseconds: number): Promise<void>;
```

From src/daemon/index.ts:
```typescript
// daemon.runWorkerIteration signature:
runWorkerIteration(workerId: string, leaseDurationMs: number, retryDelayMs?: number): Promise<AdapterWorkerExecutionResult | null>;
daemon.stop(): Promise<void>;
```

From src/daemon/adapter-worker.ts (after Plan 01):
```typescript
export interface AdapterWorkerOptions {
  readonly verboseMonitorFactory?: (agentId: string) => ProcessMonitorCallbacks;
  readonly monitor?: ProcessMonitorCallbacks;
  readonly logger?: DaemonLogger;
  // ... other fields
}
```

From src/adapters/process-runner.ts:
```typescript
// Existing constant used for per-agent timeout SIGKILL escalation:
const SIGKILL_GRACE_MS = 5_000;

// The process runner already implements SIGTERM -> 5s -> SIGKILL for per-agent timeout.
// Drain timeout needs the SAME escalation pattern but triggered from worker-command.ts
// for ALL in-flight child processes when drain timeout expires.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement concurrent slot-loop pool with drain logic and force-kill escalation</name>
  <files>src/cli/worker-command.ts, src/daemon/adapter-worker.ts</files>
  <behavior>
    - Test: --concurrency 1 (default) processes deliveries sequentially, identical to pre-Phase-7
    - Test: --concurrency 2+ processes up to N deliveries simultaneously
    - Test: SIGTERM causes worker to stop claiming and complete in-flight deliveries before exit
    - Test: drain timeout forces SIGTERM then SIGKILL on in-flight child processes
    - Test: --once with concurrency > 1 still processes exactly one delivery and exits
    - Test: lease conflict from runWorkerIteration logs at warn level with event "lease.conflict"
  </behavior>
  <action>
**Part A: Add PID tracking and force-kill hook to adapter-worker.ts**

The locked decision requires: "When drain timeout expires: SIGTERM -> 5s grace -> SIGKILL (same escalation as Phase 5 timeout)." This requires tracking PIDs of in-flight child processes and exposing a way to force-kill them from worker-command.ts.

1. **Read `src/daemon/adapter-worker.ts`** to understand the full `runIteration` flow. The child process is spawned via `runPreparedAdapterCommand` in `process-runner.ts` which returns after the process completes. The PID is available in the `onStart` monitor callback.

2. **Add an `inFlightPids` Set and a `forceKillInFlight` method** to the adapter worker return value. The `createAdapterWorker` function returns `{ runIteration }` -- extend it to also return `{ runIteration, forceKillInFlight }`:

   ```typescript
   const inFlightPids = new Set<number>();

   // Hook into the monitor to track PIDs:
   // Before calling runPreparedAdapterCommand, wrap the perDeliveryMonitor.onStart
   // to add the PID to inFlightPids, and wrap onComplete to remove it.

   function forceKillInFlight(): void {
     for (const pid of inFlightPids) {
       try {
         process.kill(-pid, "SIGTERM");
       } catch {
         // Process may have already exited
       }
     }
     // Schedule SIGKILL after 5s grace
     setTimeout(() => {
       for (const pid of inFlightPids) {
         try {
           process.kill(-pid, "SIGKILL");
         } catch {
           // Process may have already exited
         }
       }
     }, 5_000);
   }
   ```

   In `runIteration`, wrap the per-delivery monitor's `onStart`/`onComplete` to track PIDs in `inFlightPids`:
   ```typescript
   const trackingMonitor: ProcessMonitorCallbacks = {
     ...(perDeliveryMonitor ?? {}),
     onStart: (info) => {
       inFlightPids.add(info.pid);
       perDeliveryMonitor?.onStart?.(info);
     },
     onComplete: (info) => {
       inFlightPids.delete(info.pid);
       perDeliveryMonitor?.onComplete?.(info);
     }
   };
   ```

3. **Add lease conflict warn logging.** In `runIteration`, after `deliveryService.claim()` returns null, check if the claim returned null due to a lease conflict (vs simply no deliveries available). Read the claim implementation to understand the return semantics. If `claim()` can indicate a conflict (e.g., throws a specific error or returns a sentinel), log it. If `claim()` simply returns null for both "nothing available" and "conflict", the conflict detection happens at the DB layer (lease token uniqueness). In that case, add a try/catch around the claim call: if it throws a conflict-related error, log at warn level:
   ```typescript
   options.logger?.warn({ event: "lease.conflict", deliveryId: /* from error context */ }, "Lease conflict detected for delivery");
   ```
   If the claim implementation does not distinguish conflicts from empty queues, wrap the claim in a try/catch and log any error that mentions "conflict" or "lease" at warn level with `event: "lease.conflict"`. This satisfies the locked decision: "Warn on lease conflict -- log at warn level if conflict detected."

**Part B: Expose forceKillInFlight through daemon/index.ts**

4. **Read `src/daemon/index.ts`** and update the `AgentBusDaemon` interface and return value to expose `forceKillInFlight()` from the adapter worker. Add:
   ```typescript
   forceKillInFlight(): void;
   ```
   In the return object, delegate to `adapterWorker.forceKillInFlight()`.

**Part C: Replace the sequential while-loop in worker-command.ts**

5. **Create `runSlot` async function** inside `runWorkerCommand`, after daemon startup and before the main execution block. Use Option B from RESEARCH.md (mutex wraps only the capacity check + increment, runWorkerIteration runs outside mutex):

```typescript
const claimMutex = createMutex();
let inFlightCount = 0;

async function runSlot(slotIndex: number): Promise<void> {
  const slotWorkerId = `${workerId}/${slotIndex}`;

  while (!stopController.requested) {
    // Acquire slot capacity inside mutex (prevents TOCTOU)
    const canProceed = await claimMutex.run(async () => {
      if (inFlightCount >= concurrency) return false;
      inFlightCount++;
      return true;
    });

    if (!canProceed) {
      await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
      continue;
    }

    // Slot capacity acquired -- run iteration outside mutex
    try {
      const result = await daemon.runWorkerIteration(slotWorkerId, leaseDurationMs, retryDelayMs);

      if (result) {
        processedDeliveries += 1;
        writeWorkerExecutionText(io.stdout, slotWorkerId, result);

        if (once) {
          stopController.request("once");
          break;
        }
        continue; // Skip sleep, immediately try next claim
      }

      // Nothing to claim (null return -- could be empty queue or lease conflict, already logged in adapter-worker)
      idlePolls += 1;
      if (once) {
        stopController.request("once");
        if (slotIndex === 0) writeWorkerIdleText(io.stdout, workerId);
        break;
      }

      await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
    } finally {
      inFlightCount--;
    }
  }
}
```

6. **Launch the slot pool with drain timeout and force-kill escalation:**

```typescript
try {
  const slotPromises = Array.from({ length: concurrency }, (_, i) => runSlot(i));

  // Wait for all slots, but with drain timeout after stop is requested
  await new Promise<void>((resolve) => {
    // Track when all slots finish
    Promise.allSettled(slotPromises).then(() => resolve());

    // Set up drain timeout: only activates after stop is requested
    stopController.waitForStop().then(() => {
      drainedDeliveries = inFlightCount;
      sleep(drainTimeoutMs).then(() => {
        // Drain timed out -- escalate: SIGTERM -> 5s -> SIGKILL on in-flight child processes
        if (inFlightCount > 0) {
          logger.warn({ event: "drain.timeout", inFlightCount, drainTimeoutMs });
          daemon.forceKillInFlight(); // SIGTERM now, SIGKILL after 5s grace (per CONTEXT.md locked decision)
        }
        resolve();
      });
    });
  });

  return 0;
} finally {
  stopController.request(stopController.reason);
  unregisterSignals();
  await daemon.stop();
  writeWorkerStoppedText(io.stdout, {
    workerId,
    processedDeliveries,
    drainedDeliveries,
    idlePolls,
    reason: stopController.reason
  });
}
```

**Key behaviors to preserve:**
- `--once` mode: first slot that claims a delivery processes it, then requests stop. Other slots see stop and exit. With no delivery available, slot 0 writes idle text.
- Error in `runWorkerIteration`: write error to stderr, return exit code 1 (same as current behavior). With concurrent slots, one slot error should not crash others. Wrap per-slot errors: if one slot throws, let others continue. Log the error but don't return 1 immediately.
- `drainedDeliveries` is the in-flight count at the moment stop is requested (snapshot of deliveries that needed draining).
- **Drain timeout escalation (LOCKED DECISION):** When drain timeout expires, call `daemon.forceKillInFlight()` which sends SIGTERM to all in-flight child process groups, then SIGKILL after 5s. Force-killed deliveries go to retry via existing recovery mechanism (lease expires, recovery scan picks them up).
  </action>
  <verify>
    <automated>cd /Users/macbook/Data/Projects/agent-bus && npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js</automated>
  </verify>
  <done>
    - Sequential loop replaced with slot-loop pool
    - Concurrency 1 behaves identically to pre-Phase-7
    - Claim mutex prevents TOCTOU on in-flight count
    - Drain timeout triggers SIGTERM -> 5s grace -> SIGKILL on in-flight child processes (per locked decision)
    - Force-killed deliveries are handled by existing recovery scan (lease expiry)
    - Lease conflict from claim is logged at warn level with event "lease.conflict" and deliveryId
    - Worker identity uses slot suffix: `worker-{pid}/0`
    - All existing tests pass
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add integration tests for concurrency, default behavior, drain, and lease conflict warning</name>
  <files>test/cli/worker-command.test.ts</files>
  <behavior>
    - Test: --concurrency flag validation (--concurrency 0 fails, --concurrency 1 succeeds, omitted defaults to 1)
    - Test: --drain-timeout-ms flag validation (--drain-timeout-ms -1 fails, omitted defaults to 30000)
    - Test: startup banner includes "concurrency: N" and "drainTimeoutMs: N" lines
    - Test: stopped text includes "drainedDeliveries: 0" when no drain needed
    - Test: --once with concurrency defaults processes exactly one delivery (backward-compat)
    - Test: concurrent execution with 2+ deliveries available processes them in parallel (if feasible with test fixture)
    - Test: lease conflict warning is emitted at warn level with event "lease.conflict" when a conflict is detected
  </behavior>
  <action>
Read the existing `test/cli/worker-command.test.ts` to understand the test patterns (manifest setup, daemon creation, event publishing, worker invocation).

Add the following test cases using the established patterns:

1. **Flag validation tests:**
   - `--concurrency 0` returns exit code 1 with error message
   - `--concurrency abc` returns exit code 1 with error message
   - `--concurrency 1` is accepted (no error)
   - `--drain-timeout-ms -1` returns exit code 1
   - Unknown flag `--drain-timeout-ms` without value returns exit code 1

2. **Banner and summary tests:**
   - Worker started text includes `concurrency: 1` when omitted
   - Worker started text includes `concurrency: 4` when `--concurrency 4` is passed
   - Worker started text includes `drainTimeoutMs: 30000` when omitted
   - Worker stopped text includes `drainedDeliveries: 0`

3. **Default concurrency backward-compat test:**
   - Set up manifest with one agent, publish one event, run worker with `--once` (no `--concurrency` flag)
   - Verify exactly one delivery is processed (same as pre-Phase-7 behavior)
   - Verify worker ID in output uses slot suffix format (`worker-{id}/0`)

4. **Concurrent execution test (if feasible):**
   - Set up manifest with one agent subscribing to a topic, publish 2+ events
   - Run worker with `--concurrency 2 --once` -- verify both deliveries are processed
   - This test may be tricky since `--once` stops after first delivery. Alternative: run without `--once`, send SIGTERM after a delay, verify multiple deliveries processed. Use the existing test infrastructure patterns.

5. **Lease conflict warning test:**
   - Verify that when `runWorkerIteration` encounters a lease conflict (e.g., claim throws a conflict error), a warn-level log is emitted with `event: "lease.conflict"` and the relevant `deliveryId`
   - This can be tested by examining NDJSON stderr output for the warn-level log line containing `"lease.conflict"`
   - If direct conflict simulation is not feasible in the test fixture, verify the code path exists by checking that the warn log call is reachable (e.g., mock or stub the claim to throw a conflict error)

**Test pattern guidance from existing tests:**
- Tests use `createTestManifest()` or similar helpers
- Tests capture stdout/stderr via mock `WritableTextStream`
- Tests call `runWorkerCommand(args, io)` directly
- Use `describe`/`it` from `node:test`
  </action>
  <verify>
    <automated>cd /Users/macbook/Data/Projects/agent-bus && npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js</automated>
  </verify>
  <done>
    - Flag validation tests pass for --concurrency and --drain-timeout-ms
    - Banner output tests verify concurrency and drainTimeoutMs fields
    - Backward-compat test confirms --once without --concurrency processes exactly 1 delivery
    - Lease conflict warning test confirms warn-level log with event "lease.conflict"
    - All new tests green alongside existing tests
    - `npm test` (full suite) passes
  </done>
</task>

</tasks>

<verification>
- `npm run build` succeeds with no TypeScript errors
- `npm run typecheck` passes
- `node --experimental-sqlite --test dist/test/cli/worker-command.test.js` -- all tests pass (existing + new)
- `npm test` -- full test suite green
- Worker with `--concurrency 1` (or omitted) behaves identically to pre-Phase-7
- Worker with `--concurrency N` can process up to N deliveries simultaneously
- SIGTERM triggers drain: stops claiming, waits for in-flight, then exits
- Drain timeout escalates: SIGTERM -> 5s -> SIGKILL on in-flight child processes
- Lease conflict logged at warn level with event "lease.conflict"
</verification>

<success_criteria>
- WORKER-01: `--concurrency N` runs up to N parallel deliveries (verified by integration test)
- WORKER-02: Default concurrency 1 preserves backward-compatible behavior (verified by test)
- WORKER-03: SIGTERM drains all in-flight deliveries before exit (verified by test)
- Drain timeout triggers SIGTERM -> 5s grace -> SIGKILL on in-flight child processes (per locked decision)
- Lease conflict is logged at warn level when detected
- Claim mutex prevents TOCTOU on concurrent claim attempts
- Worker identity uses slot suffix format
- Full test suite green
</success_criteria>

<output>
After completion, create `.gsd/phases/7/02-SUMMARY.md`
</output>
