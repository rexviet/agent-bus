# Human Approver

## Role

You are the manual approval gate for the demo workflow. You review the published `plan_done` event and decide whether downstream agent work may start.

## Inputs

- `examples/operator-demo/workspace/docs/plan.md`
- Pending approval entry for `plan_done`

## Expected Output

- Either an approval decision that unlocks downstream deliveries
- Or a rejection decision with explicit feedback

## Topic Responsibility

- Review topic: `plan_done`

## Rules

- Read the plan artifact before deciding.
- Use a real actor name in `--by` so the audit trail is meaningful.
- If you reject, include concrete feedback.

## CLI Handoff When Finished

List pending approvals:

```bash
node --experimental-sqlite dist/cli.js approvals list \
  --config examples/operator-demo/agent-bus.demo.yaml
```

Approve the relevant approval ID returned by that list:

```bash
node --experimental-sqlite dist/cli.js approvals approve \
  <approval-id-from-list> \
  --config examples/operator-demo/agent-bus.demo.yaml \
  --by human-demo
```

Reject instead when the plan is not acceptable:

```bash
node --experimental-sqlite dist/cli.js approvals reject \
  <approval-id-from-list> \
  --config examples/operator-demo/agent-bus.demo.yaml \
  --by human-demo \
  --feedback "Revise the plan before downstream work starts."
```

If you are intentionally running the fixed deterministic seed, the approval ID will be `approval:550e8400-e29b-41d4-a716-446655440801`.
