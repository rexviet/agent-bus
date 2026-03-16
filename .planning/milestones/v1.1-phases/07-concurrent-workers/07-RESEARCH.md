# Phase 7: Concurrent Workers - Research

**Researched:** 2026-03-15
**Domain:** Node.js concurrent async worker pool, graceful shutdown drain, SQLite lease serialization
**Confidence:** HIGH

## Summary

Phase 7 extends the existing single-slot worker loop in `worker-command.ts` into a concurrent pool where N independent slots each claim and execute deliveries in parallel. The architecture is already partitioned correctly: `runWorkerIteration` in `adapter-worker.ts` is a self-contained async function that claims, executes, and transitions a single delivery — it can be called concurrently without modification to its core logic.

The two new challenges are: (1) **concurrency governance** — preventing more than N simultaneous claims, and ensuring two slots never claim the same delivery; and (2) **graceful drain** — on SIGINT/SIGTERM, stop new claims immediately, wait for all in-flight `runIteration` promises to settle before calling `daemon.stop()`. Both problems are well-scoped and do not require any third-party libraries. Node.js `Promise.allSettled`, a simple in-process mutex, and a `Set` of in-flight promises provide everything needed.

The changes touch four files: `worker-command.ts` (main logic), `output.ts` (banner/summary extensions), `adapter-worker.ts` (verbose monitor per-delivery agent ID), and `daemon/logger.ts` (workerId binding in child logger). With concurrency 1, all new code paths reduce to the existing sequential behavior — backward compatibility is automatic.

**Primary recommendation:** Implement a slot-loop pool where each slot independently loops (claim → run → repeat until stop), guarded by a single async mutex on the claim call and an in-flight count check before entering the mutex. Drain on stop by awaiting all active slot promises.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Shutdown drain behavior**
- On SIGINT/SIGTERM, stop claiming immediately — no new deliveries are picked up
- Wait for all in-flight deliveries to complete, up to a configurable drain timeout
- New CLI flag: `--drain-timeout-ms N` (default 30000 — 30 seconds)
- When drain timeout expires: SIGTERM → 5s grace → SIGKILL (same escalation as Phase 5 timeout)
- Drained deliveries that were force-killed go to retry via existing recovery mechanism
- Worker stopped text includes drain count (e.g., "3 deliveries drained, 12 total processed")

**Verbose output with concurrency**
- Each `--verbose` output line prefixed with agent ID: `[planner] stdout | processing file...`
- Agent ID only — no delivery ID in the prefix (delivery ID is in structured logs for deeper correlation)
- Worker startup banner includes concurrency setting: "Worker started: worker-1234, concurrency: 4, poll: 1000ms"
- Current static "agent" label replaced with actual agent ID per delivery (requires per-delivery monitor construction)

**SQLite contention**
- Serialize claims via mutex — only one slot calls `claim()` at a time
- Before claiming, check in-flight count < concurrency limit — natural backpressure, no over-committing leases
- Acknowledge/fail operations are per-delivery and don't need serialization
- WAL mode handles concurrent reads naturally

**Worker identity**
- Shared base ID with slot suffix: `worker-1234/0`, `worker-1234/1`, etc.
- Base worker ID from `--worker-id` flag (or default `worker-{pid}`), slot index appended
- Structured NDJSON logs include `workerId` field in each delivery log line for slot-level correlation
- Consistent with existing correlation fields (deliveryId, agentId, runId)

**Delivery exclusivity**
- Mutex on claim + lease check — the serialized claim mutex prevents two slots from racing on the same delivery
- Lease token uniqueness at the DB level is the second guard (belt and suspenders)
- Warn on lease conflict — log at warn level if a conflict is detected: "Lease conflict detected for delivery X"
- One delivery is only ever processed by one worker slot at a time

### Claude's Discretion
- Worker pool implementation pattern (Promise.allSettled, worker loop per slot, semaphore, etc.)
- How the claim mutex is implemented (e.g., simple async lock, Mutex class)
- Where drain logic lives (worker-command.ts vs daemon index)
- How per-delivery monitors replace the current global monitor for verbose output

### Deferred Ideas (OUT OF SCOPE)
- Per-agent concurrency limits (e.g., "max 2 planner agents at once") — future phase if needed
- Dynamic worker pool scaling based on queue depth — out of scope (REQUIREMENTS explicitly excludes this)
- Worker lifecycle structured log events (worker.started, worker.stopped, worker.idle) — noted as deferred in Phase 6
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WORKER-01 | Operator can start daemon with `--concurrency N` flag to run up to N deliveries in parallel | New CLI flag parsed by `parseIntegerAtLeast()` (min 1); pool of N slot loops each calling `runWorkerIteration` independently |
| WORKER-02 | Daemon defaults to concurrency 1, preserving backward-compatible behavior | Default value 1 in flag parsing; with N=1 pool has one slot loop — identical to current sequential loop |
| WORKER-03 | Daemon drains all in-flight deliveries to completion before shutting down | On stop: set stopRequested flag, await all active slot promises (via Set + Promise.allSettled), then call daemon.stop() |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:async_hooks` / plain Promise | built-in | Mutex / async coordination | No external dep needed; a promise-chaining mutex is 10 lines |
| `node:events` | built-in | Already used in process-runner.ts (`once`) | Project uses it for child process close events |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new required | — | All concurrency primitives are built into the Node.js runtime | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled promise mutex | `async-mutex` npm package | Hand-rolled is 10 lines and zero dependencies; matches project's no-external-dep preference for daemon primitives |
| `Promise.allSettled` for drain | `p-limit` npm package | `Promise.allSettled` covers the drain use case without adding a dependency |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

No new files or directories required. Changes are confined to:

```
src/
├── cli/
│   ├── worker-command.ts   # Add --concurrency, --drain-timeout-ms; replace sequential loop with pool
│   └── output.ts           # Extend writeWorkerStartedText, writeWorkerStoppedText; fix agentId in verbose
├── daemon/
│   ├── adapter-worker.ts   # Pass workerId to child logger; verbose monitor per-delivery (agentId)
│   └── logger.ts           # Add workerId to child() bindings
```

### Pattern 1: Slot-Loop Pool

**What:** N independent async slot loops. Each loop checks stop flag → checks in-flight count < N (with mutex) → claims → runs → releases slot → repeat. All slots run concurrently as independent Promise chains.

**When to use:** Static concurrency N set at startup; each slot is an independent consumer of the same shared claim queue.

**Example:**
```typescript
// Conceptual — worker-command.ts
async function runSlot(slotIndex: number): Promise<void> {
  const slotWorkerId = `${workerId}/${slotIndex}`;

  while (!stopController.requested) {
    // Mutex: only one slot calls claim() at a time
    const result = await claimMutex.run(async () => {
      if (inFlight.size >= concurrency) return null;          // backpressure
      return daemon.runWorkerIteration(slotWorkerId, leaseDurationMs, retryDelayMs);
      // runIteration atomically claims inside the mutex window
    });

    if (result) {
      // ...handle result, increment processedDeliveries
      if (once) { stopController.request("once"); break; }
      continue;
    }

    // Nothing to claim — sleep or wait for stop
    await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
  }
}

// Drain: start all slots, await all to finish
const slotPromises = Array.from({ length: concurrency }, (_, i) => runSlot(i));
await Promise.allSettled(slotPromises);
```

**Key insight:** The mutex wraps only the `claim()` call path. Since `runIteration` already claims inside its first statement, running it inside the mutex means only one slot can be mid-claim at a time. After the claim returns (or returns null), the mutex is released and other slots can proceed.

**Concurrency 1 equivalence:** With N=1, `inFlight.size >= 1` will be true while the single slot is working, so the mutex path blocks naturally — producing the same sequential behavior as today.

### Pattern 2: Promise-Chaining Mutex

**What:** A sequential queue implemented as a self-replacing promise chain.

**When to use:** Serializing a critical section across concurrent async callers without OS primitives.

**Example:**
```typescript
// Simple async mutex — no external dependency
function createMutex() {
  let chain: Promise<void> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = chain.then(() => fn());
      // Prevent rejection from breaking the chain
      chain = result.then(
        () => {},
        () => {}
      );
      return result;
    }
  };
}
```

### Pattern 3: In-Flight Tracking Set

**What:** A `Set<Promise<void>>` holding the active slot task promises. Before claiming, check `set.size < concurrency`. After each slot's iteration completes, remove from set (handled automatically if slots are tracked externally at the pool level).

**When to use:** Need a fast O(1) count of active work items; need to await all of them for drain.

**Example:**
```typescript
// Track active iterations (not slots — slots are always running in the pool model)
// Alternative simpler approach: use an atomic counter
let inFlightCount = 0;

// In slot loop, before claim:
if (inFlightCount >= concurrency) {
  await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
  continue;
}

// After claim succeeds, increment; after runIteration resolves, decrement
inFlightCount++;
try {
  result = await daemon.runWorkerIteration(...);
} finally {
  inFlightCount--;
}
```

**Note:** With the mutex approach, the counter check and claim are atomic, so no TOCTOU between checking count and claiming.

### Pattern 4: Drain Timeout with Force-Kill

**What:** After stop is requested and all in-flight slot loops must drain, a timeout races against completion. When the timeout expires, SIGTERM is sent to in-flight agent processes, then SIGKILL after 5s.

**Implementation approach:** The existing `ProcessMonitorCallbacks.timeoutMs` mechanism in `process-runner.ts` is NOT the right hook here — that's per-agent timeout. Drain timeout is different: it's a one-shot timer started when shutdown is requested, after which we force-kill any spawned child process groups.

**Recommended approach:** The slot loops themselves hold the in-flight delivery promises. On drain timeout, calling `process.kill(-pid, "SIGTERM")` on tracked child PIDs — but PIDs are not surfaced by `runIteration`. The simpler approach: let recovery handle force-killed deliveries (existing recovery scan transitions them back to `ready`). The drain timeout just resolves the pool-await with `Promise.race`.

```typescript
// Drain sequence in worker-command.ts
stopController.request("signal SIGTERM");

const drainPromise = Promise.allSettled(slotPromises);
const timeoutPromise = sleep(drainTimeoutMs).then(() => "timeout" as const);

const outcome = await Promise.race([drainPromise, timeoutPromise]);

if (outcome === "timeout") {
  // Slots may still be executing; their in-flight deliveries will be picked
  // up by recovery scan when leases expire.
  drainedCount = "forced";
}
```

### Anti-Patterns to Avoid

- **Serializing all of runIteration inside the mutex:** The mutex should wrap only the claim check + claim call, not the entire agent execution. Serializing the whole iteration eliminates parallelism.
- **Calling daemon.stop() before awaiting slots:** `daemon.stop()` closes the SQLite database. Slots still running `runIteration` will crash with "database closed" errors. Always drain first.
- **Using per-slot workerId without the base:** The `workerId` field in DB lease records must be unique per slot to disambiguate ownership. Slots sharing a workerId would prevent diagnosing which slot holds a given lease.
- **Sharing a single global monitor closure across concurrent deliveries:** The current global `monitor` captures `"agent"` as a static label. With concurrent deliveries, multiple agent processes write to the same label. Must construct per-delivery monitors with the actual `agentId`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async mutex for claim serialization | Custom lock with flags/booleans | Promise-chaining mutex (10 lines, see above) | Promise chain naturally serializes without polling; correct under event loop |
| Drain await | Manual ref counting with callbacks | `Promise.allSettled(slotPromises)` | Built-in; handles any number of slots; captures all results for summary |
| Concurrency limiting | Semaphore class | In-flight counter + mutex on claim | Simpler; semantics match the problem (claim gate, not general semaphore) |

**Key insight:** Node.js single-threaded event loop means there are no true data races between async operations. The mutex is needed only because `claim()` is a SQLite write that must not be interleaved with itself across concurrent `await` points — not because of CPU concurrency.

---

## Common Pitfalls

### Pitfall 1: Closing Database Before Drain

**What goes wrong:** `daemon.stop()` in the `finally` block runs before awaiting all slot promises. Slots mid-execution hit `Error: database closed` when they try to acknowledge or fail their delivery.

**Why it happens:** The current `finally` block runs immediately after `stopController.request()`. With concurrent slots, multiple iterations may be awaiting their agent process.

**How to avoid:** Drain ALL slot promises (`await Promise.allSettled(slotPromises)`) before entering the `finally` block that calls `daemon.stop()`. The `finally` block structure must be reorganized: stop-signal → drain → cleanup.

**Warning signs:** Tests that shut down mid-execution see `Error: database closed` or uncaught promise rejections from slot loops.

### Pitfall 2: Mutex Scope Too Wide

**What goes wrong:** The entire `runIteration` call (including agent process execution — potentially minutes) is placed inside the mutex. All N slots queue behind it, providing no parallelism.

**Why it happens:** Reasonable-sounding safety instinct — "serialize all DB writes."

**How to avoid:** The mutex covers ONLY the claim step: check in-flight count, call `deliveryService.claim()`. The rest of `runIteration` (materialize, spawn, ack/fail) is already safe without serialization because it's delivery-scoped.

**Warning signs:** `--concurrency 4` runs at the same throughput as `--concurrency 1`.

### Pitfall 3: TOCTOU on In-Flight Count

**What goes wrong:** Slot A checks `inFlightCount < 4` and sees 3. Before it increments, Slot B also checks and sees 3. Both proceed to claim, resulting in 5 in-flight deliveries against a limit of 4.

**Why it happens:** Check and increment are two separate statements; an `await` between them yields to other slots.

**How to avoid:** Perform the count check AND the claim inside a single mutex-protected block. No `await` between the check and the increment.

### Pitfall 4: Per-Delivery Verbose Monitor Construction

**What goes wrong:** The global `monitor` object captures `"agent"` as the label. With N concurrent deliveries, output lines all read `[agent:stdout]` regardless of which agent produced them.

**Why it happens:** Current code (worker-command.ts:228-263) builds one monitor at startup using a static string.

**How to avoid:** Move monitor construction inside `runIteration` (in `adapter-worker.ts`) or construct it per claim (passing `agentId` once the delivery is claimed). The `ProcessMonitorCallbacks` type supports per-call construction.

**Implementation note (from CONTEXT.md):** Per-delivery monitors are already constructed in Phase 5 for timeout (`perDeliveryMonitor`, `adapter-worker.ts:371-374`). The same pattern extends to verbose callbacks. The `options.monitor` is used as a base, and the per-delivery monitor merges in agentId-aware verbose callbacks.

### Pitfall 5: WorkerId Not Propagated to Logger Child

**What goes wrong:** Structured logs show `deliveryId`/`agentId`/`runId` but no `workerId`, making it impossible to correlate which slot handled a delivery when analyzing concurrent execution.

**Why it happens:** The child logger is created in `adapter-worker.ts:362-366` without a `workerId` binding.

**How to avoid:** Pass `workerId` (the slot-specific ID like `worker-1234/0`) into `runIteration` input and include it in the `logger.child()` call.

---

## Code Examples

Verified patterns from existing codebase:

### Current Sequential Loop (to be replaced)
```typescript
// src/cli/worker-command.ts:289-323 (current)
while (!stopController.requested) {
  result = await daemon.runWorkerIteration(workerId, leaseDurationMs, retryDelayMs);

  if (result) {
    processedDeliveries += 1;
    writeWorkerExecutionText(io.stdout, workerId, result);
    if (once) { stopController.request("once"); break; }
    continue;
  }

  await Promise.race([sleep(pollIntervalMs), stopController.waitForStop()]);
}
```

### Per-Delivery Monitor Pattern (established in Phase 5, adapter-worker.ts:371-374)
```typescript
// src/daemon/adapter-worker.ts:371-374 (existing pattern to extend)
const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
  agent.timeout !== undefined
    ? { ...(options.monitor ?? {}), timeoutMs: agent.timeout * 1000 }
    : options.monitor;
```
Extension for verbose: merge agentId-prefixed callbacks into `perDeliveryMonitor`.

### Child Logger Creation (adapter-worker.ts:362-366)
```typescript
// src/daemon/adapter-worker.ts:362-366 (current — extend with workerId)
deliveryLogger = options.logger?.child({
  deliveryId: claimedDelivery.deliveryId,
  agentId: claimedDelivery.agentId,
  runId: event.runId
  // ADD: workerId: input.workerId  (already in RunWorkerIterationInput)
});
```

### writeWorkerStartedText (output.ts:252-272) — extend options type
```typescript
// src/cli/output.ts:252-272 (current signature — needs concurrency field)
export function writeWorkerStartedText(
  stream: WritableTextStream,
  options: {
    readonly workerId: string;
    readonly configPath: string;
    readonly pollIntervalMs: number;
    readonly leaseDurationMs: number;
    readonly retryDelayMs?: number;
    readonly once: boolean;
    // ADD: readonly concurrency: number;
    // ADD: readonly drainTimeoutMs: number;
  }
): void { ... }
```

### writeWorkerStoppedText (output.ts:311-325) — extend summary type
```typescript
// src/cli/output.ts:311-325 (current — needs drainedDeliveries field)
export function writeWorkerStoppedText(
  stream: WritableTextStream,
  summary: {
    readonly workerId: string;
    readonly processedDeliveries: number;
    readonly idlePolls: number;
    readonly reason: string;
    // ADD: readonly drainedDeliveries: number;
  }
): void { ... }
```

### parseIntegerAtLeast (worker-command.ts:61-77) — reuse for new flags
```typescript
// Already handles: return null when value is undefined, throw on invalid
leaseDurationMs = parseIntegerAtLeast(readOptionValue(args, "--lease-duration-ms"), ...) ?? 60_000;
// Same pattern for:
concurrency = parseIntegerAtLeast(readOptionValue(args, "--concurrency"), "--concurrency", 1) ?? 1;
drainTimeoutMs = parseIntegerAtLeast(readOptionValue(args, "--drain-timeout-ms"), "--drain-timeout-ms", 0) ?? 30_000;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential single-slot loop | Concurrent N-slot pool | Phase 7 (now) | Operators can saturate agent capacity |
| Static `"agent"` verbose label | Per-delivery `agentId` verbose label | Phase 7 (now) | Concurrent output is attributable per agent |
| No drain on shutdown | Drain all in-flight before stop | Phase 7 (now) | SIGTERM no longer abandons mid-execution deliveries |

**Deprecated/outdated after Phase 7:**
- Global `monitor` object in `worker-command.ts`: replaced by per-delivery monitor construction inside `runIteration` (with verbose callbacks receiving actual agentId)

---

## Open Questions

1. **Where exactly to construct per-delivery verbose monitor**
   - What we know: Phase 5 establishes the `perDeliveryMonitor` pattern in `adapter-worker.ts` lines 371-374. CONTEXT.md mentions "per-delivery monitor construction (already done for timeout in Phase 5) extended to include verbose callbacks with agent ID."
   - What's unclear: The `options.monitor` in `AdapterWorkerOptions` is the global callback set. Verbose callbacks need `agentId` which is only known after claim. The agentId is available at line 369 (`claimedDelivery.agentId`) before the `perDeliveryMonitor` construction.
   - Recommendation: Extend the `perDeliveryMonitor` block (lines 371-374) to also wrap verbose callbacks with agentId prefix when `options.verboseStream` (or similar) is provided, OR pass the verbose stream + a factory function through `AdapterWorkerOptions`. The planner should decide the precise interface shape.

2. **Drain count definition**
   - What we know: CONTEXT.md says "3 deliveries drained, 12 total processed". Drain count is deliveries that were in-flight at shutdown time (not total processed).
   - What's unclear: Is "drained" only completed deliveries, or does it include force-killed ones?
   - Recommendation: Define `drainedDeliveries` as the number of in-flight deliveries at stop time, regardless of their final status. The stop summary message already has `processedDeliveries` for total.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no external test runner) |
| Config file | None — tests are run directly |
| Quick run command | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORKER-01 | `--concurrency 4` runs up to 4 deliveries simultaneously | integration | `node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | Partial (file exists, new test needed) |
| WORKER-01 | `--concurrency` validates min 1 | unit | same | Partial (existing validation tests, extend) |
| WORKER-02 | Default concurrency 1 matches sequential behavior | integration | same | Partial (existing `--once` test verifies 1 delivery) |
| WORKER-03 | SIGTERM drains in-flight deliveries before exit | integration | same | No (new test needed) |
| WORKER-03 | Drain timeout forces stop if deliveries exceed timeout | integration | same | No (new test needed) |

### Sampling Rate
- **Per task commit:** `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- New test cases in `test/cli/worker-command.test.ts` — covers WORKER-01 (concurrent execution), WORKER-02 (default concurrency), WORKER-03 (drain on shutdown)
- No new test files or framework config needed (existing test infrastructure is sufficient)

---

## Sources

### Primary (HIGH confidence)
- Direct code read of `src/cli/worker-command.ts` — full sequential loop, flag parsing, stop controller, signal handlers
- Direct code read of `src/daemon/adapter-worker.ts` — `runIteration` shape, per-delivery monitor pattern (Phase 5), child logger creation
- Direct code read of `src/daemon/index.ts` — `runWorkerIteration` delegation, `daemon.stop()` behavior (closes DB)
- Direct code read of `src/adapters/process-runner.ts` — `ProcessMonitorCallbacks` shape, existing SIGKILL_GRACE_MS = 5000
- Direct code read of `src/cli/output.ts` — exact signatures of `writeWorkerStartedText`, `writeWorkerStoppedText`, `writeAgentOutputLine`
- Direct code read of `src/daemon/logger.ts` — `child()` available via pino Logger type
- Direct code read of `test/cli/worker-command.test.ts` — existing test coverage, infrastructure patterns
- `.planning/phases/07-concurrent-workers/07-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- Node.js documentation (general knowledge): `Promise.allSettled`, `Promise.race` semantics are stable since Node 12
- Promise-chaining mutex pattern: well-established Node.js pattern, no external source needed

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all primitives are built-in Node.js
- Architecture: HIGH — based on direct code read of all integration points
- Pitfalls: HIGH — derived from examining actual code (database close timing, mutex scope, TOCTOU)

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain; no fast-moving dependencies)
