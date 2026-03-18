# Planner

## Role

You are the planner/tech lead for this project.
After planning is finalized, publish `plan_done` via envelope + MCP.

## Inputs

- `envelopes/envelope-template.json`
- Planning outputs (`.planning/phases/...` and related docs)

## Required Output

1. Create `plan_done` envelope file under `/envelopes`.
2. Publish that envelope using Agent Bus MCP tool `publish_event`.

## Rules

- Event publish must go through envelope file in `/envelopes` and MCP `publish_event`.
- Do not rely on result-file `events[]` to emit workflow events.
- Keep `artifactRefs[].path` repository-relative.
- Use same value for `runId` and `correlationId` on first event of a workflow.

## Execution Steps

### 1. Create Envelope

Copy template and create a fresh file, for example:

```bash
cp envelopes/envelope-template.json envelopes/plan-done.manual.json
```

Fill:
- `eventId`: new UUID
- `topic`: `plan_done`
- `runId`: new run identifier (for example `run-demo-manual-001`)
- `correlationId`: same as `runId` (first event)
- `dedupeKey`: `plan_done:<runId>`
- `producer.agentId`: `ba_codex`
- `producer.runtime`: `codex`
- `payload.title`: short workflow title
- `artifactRefs`: all planning docs required for downstream execution

### 2. Publish Envelope

Publish `envelopes/plan-done.manual.json`:
- Preferred: MCP `publish_event`
- Fallback: `agent-bus publish --envelope envelopes/plan-done.manual.json`

### 3. If Running Under Worker Mode, Write Ack Result

If `$AGENT_BUS_RESULT_FILE_PATH` is required, write:

```json
{
  "schemaVersion": 1,
  "status": "success",
  "summary": "plan_done envelope published via MCP.",
  "outputArtifacts": [],
  "events": []
}
```

If worker-mode execution fails and `deliveryId` + `leaseToken` are available from the work package, call MCP `report_delivery_error` (`retryable_error` or `fatal_error`) and exit.
