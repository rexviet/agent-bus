# Phase 5: Foundation Safety - Research

**Researched:** 2026-03-14
**Domain:** Node.js process group management, child_process spawn, SIGTERM/SIGKILL escalation, Zod schema extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Timeout field name:** `timeout` (not `timeoutMs`, not `processTimeout`)
- **Timeout unit in YAML:** seconds — e.g., `timeout: 30`. Internally converted to ms when passed to `ProcessMonitorCallbacks.timeoutMs`.
- **Timeout location in manifest:** on the `agent` object — `agents: [{id: planner, timeout: 300, ...}]`
- **Optional with no default:** agents without `timeout` run until they exit or the daemon stops. Backward-compatible.
- **No global workspace-level default timeout** — deferred to future milestone.
- **Grace period:** fixed 5 seconds between SIGTERM and SIGKILL — not configurable per-agent in v1.1.
- **Process group kill required:** use `process.kill(-child.pid, "SIGTERM")` and `process.kill(-child.pid, "SIGKILL")` — not `child.kill()`.
- **Delete partial result file** after SIGKILL, before retry attempt runs.
- **Retry behavior:** same `retryDelayMs` as regular failure (default 30 s). Timeout counts as a regular retry attempt toward max retries. Delivery is scheduled for retry (not dead-lettered) unless max retries are exhausted.

### Claude's Discretion

- Where exactly in `process-runner.ts` / `adapter-worker.ts` the timeout detection logic is refactored
- How `timeoutMs` is propagated from manifest agent → `ProcessMonitorCallbacks` (likely via `adapter-worker.ts` reading `agent.timeout * 1000`)
- Spawn options for detached process group (`detached: true` + `unref()` pattern, or `process.kill(-pid)` from parent)

### Deferred Ideas (OUT OF SCOPE)

- Global workspace-level `defaultTimeout` — future milestone if operators want a fallback
- `envMode: inherit|isolated` per-agent — deferred to v2 (ENVISO-01)
- Startup validation that `leaseDurationMs > timeoutMs + graceMs` — deferred to v2 (ENVISO-02)
- Timeout discrimination in dead-letter (separate exit reason) — deferred to v2 (LOG-04)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TIMEOUT-01 | Operator can configure per-agent process timeout via `timeout` field in agent manifest | Zod schema addition to `AgentSchema`; manifest loading unchanged |
| TIMEOUT-02 | Daemon sends SIGTERM to the agent process group (not just direct child) when timeout expires | `detached: true` spawn option + `process.kill(-child.pid, "SIGTERM")` replaces `child.kill("SIGTERM")` |
| TIMEOUT-03 | Daemon escalates to SIGKILL if agent process group does not exit within a grace period after SIGTERM | Second `setTimeout` of 5000 ms after SIGTERM fires `process.kill(-child.pid, "SIGKILL")`; clear both timers on normal exit |
| TIMEOUT-04 | Timed-out delivery is scheduled for retry rather than immediately dead-lettered | Route through existing `deliveryService.fail()` path in `adapter-worker.ts`, same as signal exits today |
</phase_requirements>

---

## Summary

Phase 5 wires a per-agent `timeout` field through the manifest schema and daemon runtime. The work is a targeted extension to three existing files: `manifest-schema.ts` (Zod schema), `process-runner.ts` (kill escalation), and `adapter-worker.ts` (per-delivery monitor construction and retry routing).

The core challenge is process group management. The current `child.kill("SIGTERM")` sends a signal only to the direct child process. Shell-wrapped agent commands (`["bash", "-c", "opencode ..."]`) spawn a grandchild; SIGTERM to the shell often does not reach it. Spawning with `detached: true` gives the child its own process group, and `process.kill(-child.pid, ...)` (negative PID = send to entire group) ensures every process in the tree is terminated.

The SIGKILL escalation pattern requires two coordinated timers: the first fires SIGTERM at `timeoutMs`, the second fires SIGKILL at `timeoutMs + 5000`. On normal process exit both timers must be cleared. After SIGKILL the partial result file must be deleted before returning the result so that a corrupted partial write cannot be parsed as a valid result envelope on the retry attempt.

**Primary recommendation:** Implement in three surgically scoped tasks — (1) schema + manifest validation, (2) process group kill + SIGKILL escalation in `process-runner.ts`, (3) per-delivery monitor wiring and retry routing in `adapter-worker.ts`.

---

## Standard Stack

### Core (already in project — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | built-in (Node 22.12+) | Spawn agent processes | Project already uses `spawn`; `detached` option is a native flag |
| `node:fs/promises` | built-in | Delete partial result file after SIGKILL | `rm()` already imported in `process-runner.ts` |
| `zod` | `^4.3.6` | Manifest schema validation | Project standard; `AgentSchema` already uses `.optional()` |

No new npm packages are required for this phase.

---

## Architecture Patterns

### Recommended Change Scope

```
src/
├── config/
│   └── manifest-schema.ts      # Add timeout field to AgentSchema
├── adapters/
│   └── process-runner.ts       # detached spawn, process group kill, SIGKILL escalation, result file deletion
└── daemon/
    └── adapter-worker.ts       # Build per-delivery ProcessMonitorCallbacks with timeoutMs from agent.timeout
```

### Pattern 1: Zod Optional Field with Positive Constraint

**What:** Add `timeout` as `z.number().positive().optional()` to `AgentSchema`.
**When to use:** Consistent with existing optional fields (`identityFile`, `description`, `workingDirectory`).

```typescript
// Source: existing manifest-schema.ts pattern (lines 52-56)
const AgentSchema = z.object({
  id: AgentIdSchema,
  runtime: z.string().min(1),
  description: z.string().min(1).optional(),
  identityFile: z.string().min(1).optional(),
  command: CommandSchema,
  workingDirectory: RelativeDirectorySchema.optional(),
  timeout: z.number().positive().optional(),   // NEW: seconds; no default
  environment: z.record(z.string(), z.string()).default({})
});
```

### Pattern 2: Detached Process Group Spawn

**What:** Pass `detached: true` to `spawn()` so the child gets its own process group (PGID = child PID). This is the prerequisite for `process.kill(-pid, signal)` to reach the full process tree.

**When to use:** Any time timeout enforcement is required. Backward-compatible — detached processes without `unref()` are still waited on by the parent via `await once(child, "close")`.

```typescript
// Source: Node.js docs — child_process.spawn options
const child = spawn(input.execution.command, [...input.execution.args], {
  cwd: input.execution.workingDirectory,
  env: { ...process.env, ...input.execution.environment },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true   // NEW: child gets its own process group
});
// Do NOT call child.unref() — we still await it.
```

### Pattern 3: Two-Timer SIGTERM → SIGKILL Escalation

**What:** When `timeoutMs` is set, fire SIGTERM at `timeoutMs` elapsed, then SIGKILL after an additional 5000 ms grace period. Clear both timers on normal exit.

```typescript
// Source: project decision in 05-CONTEXT.md
let sigTermHandle: ReturnType<typeof setTimeout> | undefined;
let sigKillHandle: ReturnType<typeof setTimeout> | undefined;

if (monitor?.timeoutMs !== undefined) {
  sigTermHandle = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // Process may have exited between timer fire and kill call
    }
    sigKillHandle = setTimeout(async () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already dead
      }
      // Delete partial result file to prevent corrupt read on retry
      await rm(input.materializedRun.resultFilePath, { force: true });
    }, SIGKILL_GRACE_MS);  // 5000
  }, monitor.timeoutMs);
}

// On exit, clear both timers
if (sigTermHandle !== undefined) clearTimeout(sigTermHandle);
if (sigKillHandle !== undefined) clearTimeout(sigKillHandle);
```

**Constant:** Define `const SIGKILL_GRACE_MS = 5_000;` at module scope — not configurable per CONTEXT.md.

### Pattern 4: Per-Delivery Monitor Construction in adapter-worker.ts

**What:** Currently `options.monitor` is a single global `ProcessMonitorCallbacks` passed to all iterations. Per-agent timeout requires constructing the monitor inside `runIteration` after `agent` is resolved.

```typescript
// Source: 05-CONTEXT.md integration points
const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);

// Build per-delivery monitor callbacks — merge global monitor with agent timeout
const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
  agent.timeout !== undefined
    ? {
        ...(options.monitor ?? {}),
        timeoutMs: agent.timeout * 1000
      }
    : options.monitor;

const processResult = await runPreparedAdapterCommand({
  materializedRun,
  execution: buildAdapterCommand({ ... }),
  ...(perDeliveryMonitor ? { monitor: perDeliveryMonitor } : {})
});
```

### Pattern 5: Retry Routing for Timed-Out Deliveries

**What:** A timed-out process exits with `signal: "SIGTERM"` or `"SIGKILL"` and no result envelope. The existing path (lines 404–433 of `adapter-worker.ts`) already routes signal exits through `deliveryService.fail()` — no special timeout case needed, as long as the result file is deleted after SIGKILL.

**Verification:** After SIGKILL, `result` will be `undefined` (no result envelope). `processResult.signal` will be `"SIGKILL"`. The existing `!processResult.result` branch calls `.fail()` for non-zero/signal exits. This is already the correct retry path (TIMEOUT-04 satisfied).

### Anti-Patterns to Avoid

- **`child.kill("SIGTERM")`:** Kills only the direct child PID. Shell wrappers survive. Replace with `process.kill(-child.pid, "SIGTERM")`.
- **`child.unref()` after detached spawn:** Calling `unref()` causes Node to stop waiting for the child. We need the `await once(child, "close")` to resolve. Do NOT call `unref()`.
- **Reading result file before deleting on SIGKILL:** The file may contain a partial JSON write. Always `rm()` the result file after SIGKILL, before `loadResultEnvelopeIfPresent`.
- **Forgetting to `clearTimeout` the SIGKILL timer on normal exit:** If the process exits naturally before the SIGTERM fires, both timers must be cleared. A dangling SIGKILL timer fired after the process exits by PID could theoretically kill a reused PID (unlikely but undefined behavior).
- **Not wrapping `process.kill(-pid)` in try/catch:** The process may exit between the timer callback firing and the kill syscall. `ESRCH` ("no such process") will throw without a guard.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process group tracking | Custom PID registry | `detached: true` + `process.kill(-pid)` | OS manages the process group; negative PID is the POSIX standard |
| Result file corruption guard | Checksum / atomic write | `rm(resultFilePath, { force: true })` after kill | Simpler and already correct: materializeAdapterRun pre-deletes the file; post-kill deletion re-establishes clean state |
| Timeout state machine | Custom timer class | Two `setTimeout` calls with clearTimeout guards | Node's built-in timers are sufficient; no external library needed |

**Key insight:** The complexity here is sequencing (SIGTERM → wait → SIGKILL → rm), not data structures. Two timers and a try/catch are the correct tool.

---

## Common Pitfalls

### Pitfall 1: SIGTERM Does Not Reach Shell-Wrapped Grandchildren

**What goes wrong:** Many agent commands are shell wrappers (`["bash", "-c", "opencode -p ..."]`). `child.kill("SIGTERM")` sends SIGTERM to bash. Bash may catch or forward it — but frequently the grandchild (opencode) is in the same terminal process group as bash and does not receive it. The wrapper exits, the grandchild orphans and continues running, consuming resources.

**Why it happens:** `child_process.spawn` without `detached: true` places the child in the parent's process group. `SIGTERM` to a single PID does not propagate automatically.

**How to avoid:** Spawn with `detached: true` so the child has its own process group (PGID = child.pid). Use `process.kill(-child.pid, "SIGTERM")` to target the entire group.

**Warning signs:** Process lingers after timeout; repeated SIGTERM deliveries with no effect.

### Pitfall 2: Partial Result File Poisons the Retry

**What goes wrong:** An agent is mid-write to `result.json` when SIGKILL arrives. The file exists but contains truncated JSON. On the retry attempt, `loadResultEnvelopeIfPresent` reads it, `JSON.parse` throws, and the retry also fails with a parse error rather than running the agent.

**Why it happens:** SIGKILL cannot be caught — the write is interrupted at an arbitrary byte boundary. The file is not empty (so `ENOENT` check doesn't help), but it is invalid JSON.

**How to avoid:** After SIGKILL resolves (process group exits), call `await rm(resultFilePath, { force: true })` before returning `AdapterProcessRunResult`. `materializeAdapterRun` already deletes the file before each run, but this is the post-timeout cleanup.

**Warning signs:** Retry attempts failing with `SyntaxError: Unexpected end of JSON input` in the adapter run log.

### Pitfall 3: SIGKILL Timer Not Cleared on Normal Exit

**What goes wrong:** Process exits before timeout fires. SIGTERM timer is cleared. But if SIGTERM fires (e.g., process is very slow), starts the SIGKILL timer, then the process exits naturally before SIGKILL fires — the SIGKILL timer is still live. When it fires, `process.kill(-pid)` targets a PID that may have been reused by the OS.

**Why it happens:** Two timers with interdependency; clearing only one is not enough.

**How to avoid:** Clear both `sigTermHandle` and `sigKillHandle` in the cleanup block after `exit` resolves.

**Warning signs:** Unexpected signals in unrelated processes (extremely rare on macOS/Linux with short-lived PIDs, but possible in high-concurrency scenarios).

### Pitfall 4: `process.kill(-pid)` When pid Is 0 or Undefined

**What goes wrong:** If `child.pid` is `undefined` (spawn failed, e.g., ENOENT), then `-child.pid` is `NaN`. `process.kill(NaN, ...)` may throw `ERR_INVALID_ARG_TYPE` or signal process group 0 (which means "all processes in current group" on some platforms).

**Why it happens:** `spawn` can fail asynchronously; `child.pid` is `undefined` when the binary doesn't exist.

**How to avoid:** Only set up timeout timers if `child.pid !== undefined`. The existing code already guards `onStart` with `child.pid !== undefined` — apply the same guard to the timeout timer setup.

**Warning signs:** Daemon sending SIGTERM to itself.

---

## Code Examples

### Full Revised Timeout Block in process-runner.ts

```typescript
// Source: project decision (05-CONTEXT.md) + Node.js built-in behavior
const SIGKILL_GRACE_MS = 5_000;

// Inside runPreparedAdapterCommand, after spawn():
let sigTermHandle: ReturnType<typeof setTimeout> | undefined;
let sigKillHandle: ReturnType<typeof setTimeout> | undefined;

if (monitor?.timeoutMs !== undefined && child.pid !== undefined) {
  const pid = child.pid;

  sigTermHandle = setTimeout(() => {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // ESRCH: process already exited
    }
    sigKillHandle = setTimeout(async () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // ESRCH: already dead
      }
      await rm(input.materializedRun.resultFilePath, { force: true });
    }, SIGKILL_GRACE_MS);
  }, monitor.timeoutMs);
}

const exit = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
  (resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }
);

// Clear both timers — process has exited
if (sigTermHandle !== undefined) clearTimeout(sigTermHandle);
if (sigKillHandle !== undefined) clearTimeout(sigKillHandle);
```

### Spawn with detached: true

```typescript
// Source: Node.js docs https://nodejs.org/api/child_process.html#optionsdetached
const child = spawn(input.execution.command, [...input.execution.args], {
  cwd: input.execution.workingDirectory,
  env: { ...process.env, ...input.execution.environment },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true   // gives child its own process group
  // No child.unref() — we await child.once("close")
});
```

### Per-Delivery Monitor Construction in adapter-worker.ts

```typescript
// Source: 05-CONTEXT.md integration points
const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);

const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
  agent.timeout !== undefined
    ? { ...(options.monitor ?? {}), timeoutMs: agent.timeout * 1000 }
    : options.monitor;
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `child.kill("SIGTERM")` | `process.kill(-child.pid, "SIGTERM")` | Old kills direct child only; new kills entire process group |
| Single timer (SIGTERM only) | SIGTERM timer + SIGKILL escalation timer | Handles unresponsive agents that ignore SIGTERM |
| Global `options.monitor` for all deliveries | Per-delivery monitor built from `agent.timeout` | Enables different timeouts per agent |

**Deprecated behavior being replaced:**
- `child.kill("SIGTERM")` at line 132 of `process-runner.ts` — replace with `process.kill(-child.pid, "SIGTERM")` + SIGKILL escalation.

---

## Open Questions

1. **`rm` import availability in async SIGKILL callback**
   - What we know: `rm` is already imported from `node:fs/promises` in `process-runner.ts` (line 4).
   - What's unclear: The SIGKILL callback is async (`async () => { await rm(...) }`). If the `close` event has already fired at that point, the surrounding function has returned. The `rm` call is fire-and-forget from the caller's perspective.
   - Recommendation: Accept this — the result file deletion races with nothing important. The next run's `materializeAdapterRun` also calls `rm(resultFilePath, { force: true })` as a safety net, so worst case is a brief window where the stale file exists.

2. **Process group cleanup on macOS vs. Linux**
   - What we know: `process.kill(-pid, signal)` is POSIX-standard and works on both platforms.
   - What's unclear: macOS may handle orphan process groups differently if the daemon itself exits before SIGKILL fires.
   - Recommendation: Not a concern for v1.1 — the daemon is expected to be running when the SIGKILL fires. Deferred to ENVISO-02 (startup validation).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (node:test) |
| Config file | none — invoked via `npm test` |
| Quick run command | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIMEOUT-01 | `timeout: 30` in YAML is parsed and available as `agent.timeout === 30` | unit | `node --experimental-sqlite --test dist/test/config/manifest.test.js` | ✅ (extend existing) |
| TIMEOUT-02 | SIGTERM sent to process group (not just direct child) when timeout expires | integration | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ✅ (extend existing) |
| TIMEOUT-03 | SIGKILL sent after 5 s grace if process group doesn't exit | integration | `node --experimental-sqlite --test dist/test/adapters/process-runner-monitor.test.js` | ✅ (extend existing) |
| TIMEOUT-04 | Timed-out delivery is retry_scheduled, not dead_letter | integration | `node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ (extend existing) |

### Sampling Rate

- **Per task commit:** quick run of the directly affected test file (see commands above)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

A new fixture is needed to test process group kill (TIMEOUT-02/TIMEOUT-03). The existing `monitor-fixture.mjs` delays using `setTimeout` in Node — a single-process delay. To test that grandchildren are killed, a fixture that spawns a child shell or another process is needed.

- [ ] `test/fixtures/adapters/timeout-group-fixture.mjs` — spawns a grandchild process that ignores SIGTERM; verifies the process group kill reaches the grandchild. Covers TIMEOUT-02 and TIMEOUT-03.

*(All other test files exist; new test cases will be added to existing files.)*

---

## Sources

### Primary (HIGH confidence)

- Direct code reading — `src/adapters/process-runner.ts` (lines 1–198): current spawn, timeout, and SIGTERM implementation
- Direct code reading — `src/daemon/adapter-worker.ts` (lines 86–87, 392–433): monitor options and retry routing
- Direct code reading — `src/config/manifest-schema.ts` (lines 49–57): `AgentSchema` and optional field patterns
- Direct code reading — `test/adapters/process-runner-monitor.test.ts`: existing timeout test (SIGTERM only, test 4)
- Direct code reading — `test/daemon/adapter-worker.test.ts`: retry/DLQ routing tests

### Secondary (MEDIUM confidence)

- Node.js `child_process.spawn` documentation: `detached` option creates own process group; `process.kill(-pid)` sends to group — standard POSIX behavior, well-established in Node.js ecosystem

### Tertiary (LOW confidence)

None — all claims are grounded in direct code reading or Node.js built-in documented behavior.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all built-in Node.js APIs
- Architecture: HIGH — based on direct reading of files to be modified
- Pitfalls: HIGH — derived from reading existing code and documented POSIX process group semantics

**Research date:** 2026-03-14
**Valid until:** 2026-06-14 (stable domain — Node.js built-ins and Zod 4.x)
