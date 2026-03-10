# Operator Workflow Demo

This repository ships a deterministic Phase 4 operator demo. It exercises the operator CLI surface without requiring authenticated external runtimes.

## Demo Assets

- Manifest: `examples/operator-demo/agent-bus.demo.yaml`
- Seed envelope: `examples/operator-demo/envelopes/plan-done.json`
- Seed plan artifact: `examples/operator-demo/workspace/docs/plan.md`
- Fixture agent: `test/fixtures/agents/demo-agent.mjs`

The demo workspace is isolated under `examples/operator-demo/workspace`, while runtime state and logs are isolated under `.agent-bus/demo-state` and `.agent-bus/demo-logs`.

## Prerequisites

Run all npm commands on Node `22.12.0`:

```bash
source ~/.nvm/nvm.sh
nvm use 22.12.0
npm run build
```

## Workflow

1. Publish the demo envelope:

```bash
node --experimental-sqlite dist/cli.js publish \
  --config examples/operator-demo/agent-bus.demo.yaml \
  --envelope examples/operator-demo/envelopes/plan-done.json
```

2. Inspect the pending approval:

```bash
node --experimental-sqlite dist/cli.js approvals list \
  --config examples/operator-demo/agent-bus.demo.yaml
```

3. Approve the event:

```bash
node --experimental-sqlite dist/cli.js approvals approve \
  approval:550e8400-e29b-41d4-a716-446655440801 \
  --config examples/operator-demo/agent-bus.demo.yaml \
  --by human-demo
```

4. Start a short-lived daemon shell or test harness and run worker iterations until the first failure is recorded. The deterministic fixture produces one successful system-design artifact and one retryable QA failure.

5. Inspect failures:

```bash
node --experimental-sqlite dist/cli.js failures list \
  --config examples/operator-demo/agent-bus.demo.yaml
```

6. Replay the failed delivery:

```bash
node --experimental-sqlite dist/cli.js replay delivery \
  delivery:550e8400-e29b-41d4-a716-446655440801:qa_demo \
  --config examples/operator-demo/agent-bus.demo.yaml
```

7. Run one more worker iteration. The replayed QA delivery succeeds and writes `examples/operator-demo/workspace/docs/test-cases.md`.

8. Inspect the final run state:

```bash
node --experimental-sqlite dist/cli.js runs show run-demo-001 \
  --config examples/operator-demo/agent-bus.demo.yaml
```

## Expected Outputs

- `examples/operator-demo/workspace/docs/system-design.md`
- `examples/operator-demo/workspace/docs/test-cases.md`

The final `runs show run-demo-001` output should report a `completed` run status, and `failures list` should report no remaining failure deliveries after replay and the final worker pass.
