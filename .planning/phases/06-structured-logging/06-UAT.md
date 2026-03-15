---
status: complete
phase: 06-structured-logging
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md]
started: 2026-03-15T12:00:00+07:00
updated: 2026-03-15T12:00:00+07:00
---

## Current Test

[testing complete]

## Tests

### 1. Structured lifecycle logs on stderr
expected: Run `npm run build && node --experimental-sqlite dist/src/cli.js worker --config agent-bus.yaml 2>daemon.log`. Let it run briefly (Ctrl+C to stop). Check `daemon.log` — if any deliveries were processed, each lifecycle event (delivery.claimed, agent.started, delivery.completed, etc.) should appear as a separate NDJSON line. Each line should be valid JSON.
result: pass

### 2. Correlation fields on every log line
expected: Inspect a log line from `daemon.log` (e.g., `head -1 daemon.log | jq .`). Every line should include `deliveryId`, `agentId`, `runId`, `level`, and `timestamp` fields. The values should correspond to the actual delivery being processed.
result: pass

### 3. Filter by agent with jq one-liner
expected: Run `cat daemon.log | jq 'select(.agentId == "<some-agent-id>")'` using an agentId from the logs. Only lines for that agent should appear. This confirms LOG-03 filterability.
result: pass

### 4. --log-level flag accepted
expected: Run `node --experimental-sqlite dist/src/cli.js worker --config agent-bus.yaml --log-level debug 2>daemon.log`. The daemon should start without error. Log lines in `daemon.log` should include debug-level entries (level 20) if any debug logging exists.
result: pass

### 5. Default log level is info
expected: Run `node --experimental-sqlite dist/src/cli.js worker --config agent-bus.yaml 2>daemon.log` (no --log-level flag). The daemon starts normally. Any log lines written should be at info level (30) or above — no debug (20) entries.
result: pass

### 6. Invalid --log-level rejected
expected: Run `node --experimental-sqlite dist/src/cli.js worker --config agent-bus.yaml --log-level banana`. The command should exit immediately with a clear error message about invalid log level and exit code 1 (check with `echo $?`).
result: pass

### 7. Existing worker behavior unchanged without logger
expected: Run `npm test` — all 91 tests pass. This confirms the optional logger didn't break any existing functionality.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
