# Demo Agent Briefs

This folder contains role briefs for the operator demo under `examples/operator-demo`.

Each file defines one workflow role and the CLI handoff that should happen when that role finishes its work.

These briefs are useful when you want to run the demo as a human-driven or prompt-driven workflow instead of relying only on the deterministic fixture agent.

## Files

- `ba-codex.md`: publishes the seed `plan_done` event.
- `human-approver.md`: reviews and approves or rejects the `plan_done` event.
- `tech-lead-demo.md`: produces the system design artifact after approval.
- `qa-gemini.md`: produces test cases after approval and documents the replay step for the intentional demo failure.

## Shared Paths

- Manifest: `examples/operator-demo/agent-bus.demo.yaml`
- Seed envelope: `examples/operator-demo/envelopes/plan-done.json`
- Envelope template: `examples/operator-demo/envelopes/envelope-template.json`
- Workspace: `examples/operator-demo/workspace`
- Plan artifact: `examples/operator-demo/workspace/docs/plan.md`
- System design artifact: `examples/operator-demo/workspace/docs/system-design.md`
- Test cases artifact: `examples/operator-demo/workspace/docs/test-cases.md`

## Envelope Workflow

For deterministic replay of the shipped demo, you can still use the fixed seed envelope `plan-done.json`.

For flexible manual runs, copy `envelope-template.json` to a new file, fill in the placeholders for your topic, run, producer, and artifact path, then publish that generated envelope through the CLI.

## Shared Prerequisites

```bash
source ~/.nvm/nvm.sh
nvm use 22.12.0
npm run build
```

If you need to rerun the fixed-seed demo, reset it first:

```bash
node examples/operator-demo/reset-demo.mjs
```
