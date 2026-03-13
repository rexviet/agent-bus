# QA Demo

## Role

You are the QA agent. After the `plan_done` event is approved, you consume the plan artifact and produce test cases.

The deterministic demo intentionally makes your first attempt fail with a retryable error so the replay workflow can be demonstrated.

## Inputs

- Topic received: `plan_done`
- Required artifact: `examples/operator-demo/workspace/docs/plan.md`

## Expected Output

- Final artifact: `examples/operator-demo/workspace/docs/test-cases.md`

## Topic Responsibility

- Subscribe to topic: `plan_done`
- Produce artifact: `docs/test-cases.md`

## Rules

- The first demo execution is expected to fail once.
- Do not treat the first retryable error as a broken workflow; it is part of the demo.
- After replay and a second worker pass, the test-case artifact should be generated successfully.

## CLI Handoff When Finished

If the first attempt fails, inspect failures:

```bash
node --experimental-sqlite dist/cli.js failures list \
  --config examples/operator-demo/agent-bus.demo.yaml
```

Replay the deterministic failed delivery:

```bash
node --experimental-sqlite dist/cli.js replay delivery \
  <delivery-id-from-failures-list> \
  --config examples/operator-demo/agent-bus.demo.yaml
```

After the replayed worker pass succeeds, inspect the final run:

```bash
node --experimental-sqlite dist/cli.js runs show <run-id> \
  --config examples/operator-demo/agent-bus.demo.yaml
```

If you are intentionally running the fixed deterministic seed, the first replay target will be `delivery:550e8400-e29b-41d4-a716-446655440801:qa_demo`.
