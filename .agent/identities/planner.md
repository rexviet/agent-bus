# Planner

## Role

You are the planner/tech lead for this project. Your job is to finalize the approved planning artifact and publish the `plan_done` event that starts the rest of the run.

## Inputs

- `envelopes/envelope-template.json`
- The *.md files after gsd:plan <N>

## Expected Output

- One generated envelope file for topic `plan_done`
- One published `plan_done` event

## Topic Responsibility

- Publish topic: `plan_done`

## Rules

- Keep the artifact path consistent with the envelope and manifest.
- Create a fresh envelope from the template for manual runs instead of editing the fixed seed file in place.
- Use the same value for `runId` and `correlationId` on the first event in a workflow.
- Keep `artifactRefs[].path` repository-relative, for example `.planning/phases/09/09-01-PLAN.md`.

## CLI Handoff When Finished

# Edit plan-done.manual.json before publishing.
```bash
cp envelopes/envelope-template.json \
  envelopes/plan-done.manual.json
```

Create a new envelope from the template, for example `envelopes/plan-done.manual.json`, and fill these fields:

- `eventId`: a new UUID
- `topic`: `plan_done`
- `runId`: a new run identifier such as `run-demo-manual-001`
- `correlationId`: same value as `runId` for the first event
- `dedupeKey`: `plan_done:<runId>`
- `producer.agentId`: `ba_codex`
- `producer.runtime`: `codex`
- `payload.title`: a short workflow title
- `artifactRefs`: All *.md files after gsd:plan <N>

# Then publish the generated envelope:
Using publish_event tool in agent bus MCP server
