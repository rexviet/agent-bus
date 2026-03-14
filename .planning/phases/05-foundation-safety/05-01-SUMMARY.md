---
phase: 05-foundation-safety
plan: 01
subsystem: config
tags: [manifest, schema, timeout, zod, validation]

requires:
  - null

provides:
  - AgentSchema with optional timeout field (seconds)
  - Type-safe timeout parsing via Zod validation
  - Backward-compatible manifest loading

affects:
  - Plan 05-02 (timeout conversion to ms)
  - Plan 05-03 (adapter-worker timeout enforcement)

tech-stack:
  added: []
  patterns:
    - "Optional positive number fields in Zod schemas (z.number().positive().optional())"
    - "4-part test pattern for field: with value, without value, boundary validation (0), negative validation"

key-files:
  created: []
  modified:
    - src/config/manifest-schema.ts
    - test/config/manifest.test.ts

key-decisions:
  - "Timeout stored as number (seconds) in manifest, conversion to milliseconds deferred to adapter-worker layer"
  - "Timeout field optional to maintain backward-compatibility with existing manifests"

requirements-completed:
  - TIMEOUT-01

patterns-established:
  - "Optional numeric fields follow pattern: z.number().positive().optional() to ensure valid positive integers"
  - "Test coverage for optional fields: with valid value, without field, boundary cases (0, negative)"

duration: 1min
completed: 2026-03-14
---

# Phase 5: Foundation Safety - Plan 01 Summary

**Optional timeout field (seconds) added to agent manifest schema with comprehensive validation and backward-compatibility**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-14T09:38:13Z
- **Completed:** 2026-03-14T09:39:05Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `timeout: z.number().positive().optional()` to AgentSchema in manifest-schema.ts
- Agents can now specify timeout in manifest YAML (unit: seconds)
- Backward-compatible: agents without timeout field parse correctly with timeout === undefined
- Comprehensive test coverage: valid timeout, missing timeout, rejected edge cases (0, negative)
- All 77 tests pass including 4 new timeout validation tests
- TypeScript type inference exposes `agent.timeout` as `number | undefined` to downstream consumers

## Task Commits

1. **Task 1: Add timeout field to AgentSchema and extend manifest tests** - `aec8b5e` (feat)

## Files Created/Modified

- `src/config/manifest-schema.ts` - Added `timeout: z.number().positive().optional()` field to AgentSchema (line 56)
- `test/config/manifest.test.ts` - Added 4 test cases: parseManifestText with timeout=30, without timeout, with timeout=0 (rejected), with timeout=-5 (rejected)

## Decisions Made

- **Timeout unit is seconds, not milliseconds** — Conversion to ms happens in adapter-worker.ts (downstream task). Manifest is human-readable.
- **Field is optional** — Existing manifests work without modification. Backward-compatible addition.
- **Used z.number().positive()** — Rejects 0 and negative values, which are nonsensical for timeouts.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TDD flow completed cleanly (RED → GREEN).

## Test Results

```
npm run build        ✓ (TypeScript compiled successfully)
npm run typecheck    ✓ (No type errors)
npm test             ✓ (77 tests pass)

Manifest tests specifically:
- ok 1: loadManifest parses the example manifest
- ok 2-6: Existing validation tests (all pass)
- ok 7: parseManifestText with timeout: 30 parses as number
- ok 8: parseManifestText without timeout parses with undefined
- ok 9: parseManifestText with timeout: 0 throws ManifestValidationError
- ok 10: parseManifestText with timeout: -5 throws ManifestValidationError
```

## Next Phase Readiness

Ready for Plan 05-02 (timeout conversion to milliseconds in adapter-worker initialization).

- `AgentBusManifest["agents"][number]` now includes `timeout?: number` (seconds)
- Type signature available for downstream imports from manifest-schema.ts
- Backward-compatible with existing agent-bus.yaml files

---

*Phase: 05-foundation-safety*
*Completed: 2026-03-14*
