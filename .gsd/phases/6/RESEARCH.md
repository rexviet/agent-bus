<!-- AUTO-GENERATED from .planning/phases/06-structured-logging/06-RESEARCH.md by scripts/sync-planning-to-gsd.mjs. Edit the source file, not this projection. -->

# Phase 6: Structured Logging - Research

**Researched:** 2026-03-14
**Domain:** Node.js structured logging with pino in an ESM TypeScript project
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use **pino ^9.0.0** for structured NDJSON logging
- Verify ESM import resolves correctly with `"type": "module"` before implementation
- Use **numeric log levels** (pino defaults: 30=info, 40=warn, 50=error)
- **Single root logger** created in daemon startup (`createDaemonLogger()`), passed to services via options
- **Child loggers** created per-delivery with correlation fields (`deliveryId`, `agentId`, `runId`)
- Support **`--log-level` flag** on worker command (default: `info`). Accepts: debug/info/warn/error/fatal
- **Keep both**: human-readable text on stdout (existing `output.ts` functions unchanged), structured NDJSON on stderr
- No breaking change to existing operator workflows
- Operators use `2>daemon.log` to capture structured logs separately
- `--verbose` flag continues to work for human-readable agent output on stdout
- **Core delivery events only**:
  - `delivery.claimed`
  - `agent.started`
  - `delivery.completed`
  - `delivery.retry_scheduled`
  - `delivery.dead_lettered`
- `delivery.claimed` → info (30)
- `agent.started` → info (30)
- `delivery.completed` → info (30)
- `delivery.retry_scheduled` → info (30)
- `delivery.dead_lettered` → error (50)

### Claude's Discretion
- Where exactly `createDaemonLogger()` lives (likely `src/daemon/logger.ts`)
- How the logger is threaded through `startDaemon` options to `adapter-worker`
- Whether to add a `component` field to log lines (e.g., `"component": "adapter-worker"`)
- Exact pino configuration options (timestamp format, serializers, etc.)

### Deferred Ideas (OUT OF SCOPE)
- Worker lifecycle events (worker.started, worker.stopped, worker.idle) — future phase
- Approval events (approval.requested, approval.decided) — future phase
- Timeout discrimination in dead-letter exit reason — deferred to v2 (LOG-04)
- pino-pretty as dev dependency for human-readable dev mode — nice-to-have, not required
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LOG-01 | Daemon writes structured NDJSON log lines to stderr for all delivery lifecycle events | pino's default output is NDJSON; use `pino.destination(2)` to write to stderr (fd 2) |
| LOG-02 | Each log line includes correlation fields: `deliveryId`, `agentId`, `runId`, `level`, `timestamp` | pino's `logger.child({ deliveryId, agentId, runId })` binds fields to every log line; level and timestamp are automatic |
| LOG-03 | Operator can pipe daemon stderr to `jq`/`grep` to filter by deliveryId or agentId without additional tooling | pino produces standards-compliant NDJSON; `jq 'select(.deliveryId == "x")'` works natively |
</phase_requirements>

---

## Summary

Phase 6 adds structured NDJSON logging to the agent-bus daemon. The technical domain is narrow and well-understood: install pino, create a root logger that writes to stderr, thread it through `startDaemon` options into `adapter-worker`, and emit one log line per delivery lifecycle event using a per-delivery child logger with the required correlation fields.

The project uses `"type": "module"` with TypeScript `"module": "NodeNext"`. The critical ESM safety finding is that **pino's transport worker-thread code path must be avoided**. Writing directly to `process.stderr` via `pino.destination(2)` (fd 2) runs entirely in the main thread and bypasses `thread-stream` entirely — this is the correct approach for this project. The `pino.transport()` API that spawns worker threads must not be used.

The pino 9.x TypeScript type exports had a regression introduced in 9.8.0 and fixed in 9.8.x+ via PR #2258. The locked version range `^9.0.0` will resolve to 9.14.0 (the latest 9.x release as of research date), which contains the fix. The correct import syntax post-fix is `import pino from 'pino'` with `pino({ ... }, pino.destination(2))`.

**Primary recommendation:** Create `src/daemon/logger.ts` with `createDaemonLogger(level, destination)`, add `logger` to `AdapterWorkerOptions`, and emit child-logger calls at each of the five transition points already present in `adapter-worker.ts`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pino | ^9.0.0 (resolves to 9.14.0) | Structured NDJSON logging | Fastest Node.js JSON logger; bundled TypeScript types; native child logger bindings; standard in production Node.js services |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | (already installed) | TypeScript types for `process.stderr`, `NodeJS.WritableStream` | Already a dev dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino | winston | winston is heavier and slower; pino is the industry default for NDJSON |
| pino | console.error + JSON.stringify | No levels, no child bindings, no timestamp — don't hand-roll |

**Installation:**
```bash
npm install pino@^9.0.0
```

Note: `@types/pino` is NOT needed — pino 9.x ships its own TypeScript declaration file (`pino.d.ts`).

---

## Architecture Patterns

### Recommended Project Structure

New files for this phase:

```
src/daemon/
├── logger.ts          # createDaemonLogger() factory — NEW
└── adapter-worker.ts  # add logger to AdapterWorkerOptions, add log calls — MODIFY

src/cli/
└── worker-command.ts  # parse --log-level, pass logger to startDaemon — MODIFY

src/daemon/index.ts    # add logger to StartDaemonOptions, thread to AdapterWorkerOptions — MODIFY
```

### Pattern 1: Root Logger Factory (src/daemon/logger.ts)

**What:** A single exported factory function that creates a pino logger targeting stderr via file descriptor.

**When to use:** Called once at startup in `worker-command.ts` before `startDaemon`.

**Example:**
```typescript
// src/daemon/logger.ts
import pino from 'pino';

export type DaemonLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type DaemonLogger = pino.Logger;

export function createDaemonLogger(level: DaemonLogLevel = 'info'): DaemonLogger {
  return pino(
    { level },
    pino.destination(2)  // fd 2 = stderr, runs in main thread (no worker thread)
  );
}
```

**Why `pino.destination(2)` and not `pino.transport()`:** The `pino.transport()` API spawns a worker thread and loads `thread-stream`, which references `__dirname` — a variable not available in ESM. `pino.destination(fd)` is a SonicBoom stream running in the main thread and is fully ESM-safe.

### Pattern 2: Logger Threading via Options DI

**What:** Thread logger through `StartDaemonOptions` → `AdapterWorkerOptions` following the existing `monitor` DI pattern.

**When to use:** Mirrors the established pattern for `monitor?: ProcessMonitorCallbacks`.

**Example:**
```typescript
// src/daemon/index.ts — StartDaemonOptions addition
export interface StartDaemonOptions {
  // ...existing fields...
  readonly logger?: DaemonLogger;
}

// AdapterWorkerOptions addition
export interface AdapterWorkerOptions {
  // ...existing fields...
  readonly logger?: DaemonLogger;
}

// In startDaemon body, mirror monitor pattern:
const adapterWorkerOptions: AdapterWorkerOptions = {
  // ...existing...
  ...(options.logger ? { logger: options.logger } : {})
};
```

**Why optional:** Tests that don't pass a logger must not break. When absent, no structured logs are emitted — the worker still functions correctly.

### Pattern 3: Per-Delivery Child Logger

**What:** Create one child logger per delivery iteration, binding `deliveryId`, `agentId`, and `runId` once; reuse for all events in that delivery's lifecycle.

**When to use:** At the top of `runIteration()` after `claim()` returns a non-null delivery.

**Example:**
```typescript
// adapter-worker.ts — inside runIteration(), after claim succeeds
const deliveryLogger = options.logger?.child({
  deliveryId: claimedDelivery.deliveryId,
  agentId: claimedDelivery.agentId,
  runId: claimedDelivery.runId
});

// Then at each lifecycle event:
deliveryLogger?.info({ event: 'delivery.claimed' });
deliveryLogger?.info({ event: 'agent.started' });
deliveryLogger?.info({ event: 'delivery.completed' });
deliveryLogger?.info({ event: 'delivery.retry_scheduled', errorMessage });
deliveryLogger?.error({ event: 'delivery.dead_lettered', errorMessage });
```

**Output shape (NDJSON line):**
```json
{"level":30,"time":1741910400000,"deliveryId":"dlv_abc","agentId":"planner","runId":"run_xyz","event":"delivery.claimed","msg":""}
```

### Pattern 4: --log-level CLI Flag

**What:** Parse `--log-level` in `runWorkerCommand`, default to `'info'`, validate against pino levels, create logger, pass to daemon.

**When to use:** `worker-command.ts` before calling `startDaemon`.

**Example:**
```typescript
// worker-command.ts
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal'] as const);

const rawLogLevel = readOptionValue(args, '--log-level') ?? 'info';
if (!VALID_LOG_LEVELS.has(rawLogLevel as DaemonLogLevel)) {
  writeError(io.stderr, `Invalid --log-level "${rawLogLevel}". Valid: debug, info, warn, error, fatal`);
  return 1;
}
const logLevel = rawLogLevel as DaemonLogLevel;
const logger = createDaemonLogger(logLevel);
```

Then pass `logger` into `startDaemon({ ..., logger })`.

### Anti-Patterns to Avoid

- **Using `pino.transport({ target: 'pino/file' })`**: This spawns a worker thread, triggering the `thread-stream` ESM `__dirname` error. Use `pino.destination(fd)` instead.
- **Writing JSON to stderr manually with `console.error(JSON.stringify(...))`**: No levels, no child bindings, no SonicBoom buffering.
- **Creating a child logger inside inner helper functions**: Create once at delivery start, pass down. Avoids repeated object allocation.
- **Mutating logger options after creation**: pino loggers are immutable post-construction; child loggers are the correct scoping mechanism.
- **Making logger a module-level singleton**: Violates the DI pattern established by `monitor`. Tests must be able to suppress logger output.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON serialization | Custom `JSON.stringify` loop with level/timestamp fields | `pino` | Edge cases: circular refs, BigInt, Date serialization, level coercion, buffer flushing |
| Child context binding | Closure-captured object spread on every log call | `logger.child(bindings)` | pino's child uses prototype chain; bindings are computed once, not per-line |
| Log level filtering | Manual `if (level >= minLevel)` guards | pino's built-in level config | pino's level comparison is optimized; manual guards diverge from standard semantics |

**Key insight:** The correlation field binding problem looks simple but becomes inconsistent quickly when done manually across 5 lifecycle events in an async iteration.

---

## Common Pitfalls

### Pitfall 1: ESM Worker Thread Failure

**What goes wrong:** `pino({ transport: { target: 'pino/file' } })` fails at runtime with `__dirname is not defined` or a `thread-stream` bootstrap error because the worker thread code still uses CJS globals.

**Why it happens:** pino's `transport()` API (introduced in v7) spawns a worker thread that loads `thread-stream`, which uses `__dirname`. The worker thread file is compiled for CJS but the main process is ESM, causing a resolution failure.

**How to avoid:** Use `pino(options, pino.destination(2))` — the second argument is a SonicBoom stream running in the main thread. No worker thread, no `thread-stream`.

**Warning signs:** Error containing `thread-stream` or `__dirname is not defined` in stack trace at startup.

### Pitfall 2: TypeScript Import Signature Error

**What goes wrong:** TypeScript emits `error TS2595: 'pino' can only be imported by using a default import` or `'pino' has no call signatures`.

**Why it happens:** pino 9.8.0 introduced a TypeScript export regression (PR #2223); fixed in the same 9.8.x patch series via PR #2258. If `^9.0.0` resolves to a version between 9.8.0 and the patch, types break.

**How to avoid:** Pin to `^9.0.0` which resolves to 9.14.0 (latest 9.x) — the fix is included. If types error occurs during `npm run typecheck`, run `npm install pino@latest-within-9` to force the latest patch.

**Warning signs:** TypeScript type errors about call signatures or import style at import site, not at call site.

### Pitfall 3: Logger Goes to stdout Instead of stderr

**What goes wrong:** Operators capture `2>daemon.log` but structured logs appear in stdout, mixing with human-readable text.

**Why it happens:** Default pino destination is `process.stdout` (fd 1). Not passing a destination defaults to stdout.

**How to avoid:** Always pass `pino.destination(2)` as the second argument to `pino()`.

**Warning signs:** Structured JSON lines appear in `stdout` capture during tests.

### Pitfall 4: runId Missing From Child Bindings

**What goes wrong:** Log lines omit `runId`, violating LOG-02.

**Why it happens:** `PersistedDeliveryRecord` may store `runId` under a different field name, or `runId` is set after claim (e.g., set by `deliveryService.claim` in the result).

**How to avoid:** Inspect `PersistedDeliveryRecord` type before coding — confirm the field name. If `runId` is not on `claimedDelivery`, it may need to be fetched from `runStore` or derived. Check `delivery-store.ts` and `run-store.ts` for the correct field.

**Warning signs:** `runId: undefined` in log output; `jq 'select(.runId == null)'` matches all lines.

### Pitfall 5: delivery.dead_lettered Logged at Wrong Level

**What goes wrong:** Dead-letter event logged at `info` instead of `error`, making it invisible when operator sets `--log-level error`.

**Why it happens:** Copy-paste from other lifecycle event calls.

**How to avoid:** Use `deliveryLogger?.error(...)` specifically for `delivery.dead_lettered`. The distinction is intentional per CONTEXT.md decisions.

---

## Code Examples

Verified patterns from official sources:

### Logger Factory (no transport / ESM-safe)
```typescript
// Source: pino docs — pino.destination(fd) runs in main thread
import pino from 'pino';

const logger = pino({ level: 'info' }, pino.destination(2));
// All output goes to stderr (fd 2)
```

### Child Logger with Correlation Fields
```typescript
// Source: pino child() API
const childLogger = logger.child({
  deliveryId: 'dlv_abc123',
  agentId: 'planner',
  runId: 'run_xyz789'
});

childLogger.info({ event: 'delivery.claimed' });
// Output: {"level":30,"time":...,"deliveryId":"dlv_abc123","agentId":"planner","runId":"run_xyz789","event":"delivery.claimed","msg":""}

childLogger.error({ event: 'delivery.dead_lettered', errorMessage: 'Agent exited with code 1' });
// Output: {"level":50,...,"event":"delivery.dead_lettered","errorMessage":"Agent exited with code 1"}
```

### Operator One-Liner (LOG-03 verification)
```bash
# Filter to a single agent:
agent-bus worker 2>&1 >/dev/null | jq 'select(.agentId == "planner")'

# Filter to a single delivery:
agent-bus worker 2>&1 >/dev/null | jq 'select(.deliveryId == "dlv_abc123")'

# Capture to file then query:
agent-bus worker 2>daemon.log
cat daemon.log | jq 'select(.level >= 50)'  # errors only
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.error` for daemon output | pino NDJSON to stderr | pino v1+ | Machine-parseable, structured, filterable |
| pino transport (worker thread) | pino.destination(fd) for ESM | pino v7+ known issue | ESM safety — avoids thread-stream `__dirname` error |
| `@types/pino` separate package | pino ships own `pino.d.ts` | pino v6+ | No separate types package needed |
| `import { pino } from 'pino'` named import | `import pino from 'pino'` default import | pino 9.8.x fix | TypeScript NodeNext compatibility |

**Deprecated/outdated:**
- `require('pino')`: CJS require — project is `"type": "module"`, use ESM `import`
- `pino.transport({ target: 'pino/file', ... })`: Spawns worker thread — unsafe in this ESM project; use `pino.destination(fd)` instead

---

## Open Questions

1. **Does `PersistedDeliveryRecord` have a `runId` field?**
   - What we know: `claimedDelivery` comes from `deliveryService.claim()` which returns `PersistedDeliveryRecord`
   - What's unclear: The exact field name for run ID on the delivery record — it may be `runId`, or may require lookup in `runStore`
   - Recommendation: Read `src/storage/delivery-store.ts` and `src/daemon/types.ts` before coding the child logger bindings. If `runId` is absent from the claimed delivery, use `runStore.getRunForDelivery(deliveryId)?.runId` or equivalent.

2. **Where to place `agent.started` log call — before or after `materializeAdapterRun`?**
   - What we know: CONTEXT.md lists `agent.started` as a lifecycle event; `process-runner.ts` has `onStart` callback triggered after `spawn()`
   - What's unclear: Whether `agent.started` should fire at process spawn (inside `onStart` callback) or just before `runPreparedAdapterCommand` is called
   - Recommendation: Log `agent.started` via the `onStart` callback in the `monitor` — or log immediately before `runPreparedAdapterCommand`. The latter is simpler (no monitor augmentation needed) and close enough to process start.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | none — invoked via `node --experimental-sqlite --test dist/test/**/*.test.js` |
| Quick run command | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js dist/test/cli/worker-command.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOG-01 | adapter-worker emits NDJSON lines to logger for all 5 lifecycle events | unit | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ (extend existing) |
| LOG-02 | each log line includes deliveryId, agentId, runId, level, timestamp | unit | `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js` | ✅ (extend existing) |
| LOG-03 | structured output on stderr is valid NDJSON parseable by jq | unit | `npm run build && node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | ✅ (extend existing) |

**Test strategy:** The test approach for LOG-01/02 is to pass a mock logger (object with `.child()` returning a mock that records calls) to `createAdapterWorker`. Assert that each lifecycle path calls the correct log method with the correct fields. This avoids spawning real processes for the logging path and keeps tests fast.

For LOG-03, the existing `worker-command.test.ts` captures `stderr` as a string. Tests can parse captured stderr lines as JSON and assert required fields are present.

### Sampling Rate
- **Per task commit:** `npm run build && node --experimental-sqlite --test dist/test/daemon/adapter-worker.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. No new test files need to be created; existing `adapter-worker.test.ts` and `worker-command.test.ts` are extended with new test cases.

---

## Sources

### Primary (HIGH confidence)
- pino GitHub issues #2120, #2245, #2255 — ESM compatibility, TypeScript NodeNext fix, regression and resolution
- pino `docs/transports.md` — `pino.destination(fd)` vs `pino.transport()` distinction; main thread vs worker thread behavior
- pino GitHub releases page — confirmed 9.14.0 is latest 9.x; 10.3.1 is latest overall

### Secondary (MEDIUM confidence)
- [BetterStack: Complete Guide to Pino](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) — verified import syntax `import pino from 'pino'`, child logger pattern, destination config
- [Dash0: Production-Grade Logging with Pino](https://www.dash0.com/guides/logging-in-node-js-with-pino) — confirmed `pino.destination(2)` for stderr, log level config pattern

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pino ^9.0.0 confirmed, latest 9.x is 9.14.0, TypeScript fix included
- Architecture: HIGH — DI pattern mirrors existing `monitor` pattern, `pino.destination(2)` confirmed ESM-safe
- Pitfalls: HIGH — ESM worker thread issue confirmed via GitHub issues; TypeScript regression confirmed resolved in 9.14.0
- runId field name: LOW — needs verification against `PersistedDeliveryRecord` type before implementation

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (pino 9.x is stable; no fast-moving changes expected)
