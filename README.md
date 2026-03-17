# Agent Bus

**An open protocol for multi-agent coordination, with a local-first reference runtime.**

Agent Bus defines a minimal contract — JSON in, JSON out — that any AI agent can speak regardless of model, framework, or language. The reference runtime ships as a single Node.js process backed by SQLite: durable events, fan-out subscriptions, retry/dead-letter, approval gates, artifact handoff, and a live dashboard.

```
Protocol:  work package JSON  +  result envelope JSON  +  env vars
Runtime:   daemon  →  worker  →  SQLite  →  dashboard
```

Agents don't call each other. They publish events. The bus handles the rest.

## How It Works

```
                          agent-bus.yaml
                               |
                       +-------+-------+
                       |   Agent Bus   |
                       |   (daemon)    |
                       +-------+-------+
                               |
         publish event --------+-------- fan-out to subscribers
                               |
                   +-----------+-----------+
                   |                       |
            approval gate?           deliver directly
                   |                       |
              human approves         worker claims lease
                   |                       |
              ready ───────────────> adapter spawns agent
                                           |
                                    agent reads work package
                                    agent writes result
                                           |
                              +------------+------------+
                              |            |            |
                           success    retryable     fatal
                              |        error        error
                              |            |            |
                         emit events   retry with   dead-letter
                                       backoff
```

### Delivery State Machine

```
pending_approval ──> ready ──> leased ──> completed
                                  |
                                  +──> retry_scheduled ──> ready (loop)
                                  |
                                  +──> dead_letter
```

### What Agents See

Each agent is spawned as a subprocess with three environment variables pointing to JSON files:

| Variable | Purpose |
|----------|---------|
| `AGENT_BUS_WORK_PACKAGE_PATH` | Read this — event envelope, delivery context, artifact paths |
| `AGENT_BUS_RESULT_FILE_PATH` | Write here — success/error status, follow-up events |
| `AGENT_BUS_LOG_FILE_PATH` | Write logs here |

The agent reads the work package, does its job, writes a result envelope, and exits. That's the entire contract.

## Quick Start

### Prerequisites

- **Node.js 24.0+** (required for built-in `node:sqlite`)
- One or more agent runtimes: `codex`, `claude`, `gemini`, or `opencode`

### Install

```bash
git clone https://github.com/rexviet/agent-bus.git
cd agent-bus
npm install
npm run build
```

Optional — install the `agent-bus` binary globally:

```bash
npm run link:global
```

### Verify

```bash
agent-bus validate-manifest agent-bus.example.yaml
agent-bus layout --config agent-bus.example.yaml --ensure
```

### Run

```bash
# Terminal 1: start the worker (daemon + worker loop in one process)
agent-bus worker --config agent-bus.yaml --concurrency 2 --dashboard-port 3000

# Terminal 2: publish a seed event to kick off a workflow
agent-bus publish --envelope seed-event.json --config agent-bus.yaml

# Terminal 3: inspect & approve
agent-bus approvals list
agent-bus approvals approve <approval-id> --by alice
```

Open `http://localhost:3000` for the live dashboard.

## Configuration

All configuration lives in a single YAML file — typically `agent-bus.yaml` at the repository root.

### Full Schema

```yaml
version: 1

workspace:
  artifactsDir: .agent-bus/artifacts   # shared files between agents
  stateDir: .agent-bus/state           # SQLite database
  logsDir: .agent-bus/logs             # agent execution logs

agents:
  - id: my_agent                       # lowercase, letters/digits/underscores/hyphens
    runtime: codex                     # codex | claude-code | gemini | open-code
    description: What this agent does  # optional
    identityFile: agents/my-agent.md   # optional — role/task instructions
    command:                           # executable + args
      - codex
      - exec
      - --model
      - gpt-5.3-codex
    workingDirectory: packages/app     # optional — relative to repo root
    timeout: 300000                    # optional — ms
    environment:                       # optional — extra env vars
      MY_VAR: "value"

subscriptions:
  - agentId: my_agent                  # must match an agent id
    topic: some_event                  # lowercase, letters/digits/dots/underscores/hyphens
    description: When to trigger       # optional
    requiredArtifacts:                 # optional — files agent needs
      - path: docs/plan.md
        role: input
        description: The plan file

approvalGates:                         # optional
  - topic: plan_done                   # events on this topic require approval
    decision: manual
    approvers: [human]
    onReject: return_to_producer       # or: cancel_run

artifactConventions:                   # optional — document expected outputs
  - topic: plan_done
    outputs:
      - path: docs/plan.md
        role: primary
        description: The approved plan
```

### Minimal Example

```yaml
version: 1
workspace:
  artifactsDir: workspace
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: greeter
    runtime: claude-code
    command: [claude, --model, claude-haiku-4-5-20251001]

subscriptions:
  - agentId: greeter
    topic: hello
```

## Supported Runtimes

| Runtime | Executable | Identity File | Notes |
|---------|-----------|---------------|-------|
| `codex` | `codex` | Supported | Prompt passed as final arg after `exec` |
| `claude-code` | `claude` | Supported | Prompt passed via `-p` flag |
| `gemini` | `gemini` | Supported via `@` attachment | Auto-sets `--approval-mode auto_edit` |
| `open-code` | `opencode` | Not supported | Uses `--dir` and `--file` flags |

Any unknown runtime falls back to a generic command builder — the agent receives work package location via environment variables only.

## Agent Contract

### Work Package (Bus -> Agent)

The bus writes a JSON file the agent reads from `$AGENT_BUS_WORK_PACKAGE_PATH`:

```jsonc
{
  "schemaVersion": 1,
  "agent": { "id": "my_agent", "runtime": "codex" },
  "delivery": {
    "deliveryId": "del_abc123",
    "eventId": "550e8400-...",
    "topic": "plan_done",
    "status": "leased",
    "attemptCount": 0,
    "maxAttempts": 3
    // ... timestamps, lease info
  },
  "event": {
    "eventId": "550e8400-...",
    "runId": "run_xyz",
    "topic": "plan_done",
    "correlationId": "run_xyz",
    "producer": { "agentId": "planner", "runtime": "claude-code" },
    "payload": { /* arbitrary JSON from producer */ },
    "artifactRefs": [
      { "path": "docs/plan.md", "role": "primary" }
    ]
    // ... timestamps
  },
  "artifactInputs": [
    {
      "path": "docs/plan.md",
      "absolutePath": "/abs/path/to/workspace/docs/plan.md",
      "role": "primary"
    }
  ],
  "workspace": {
    "repositoryRoot": "/abs/path/to/repo",
    "workspaceDir": "/abs/path/to/repo/.agent-bus/artifacts",
    "workingDirectory": "/abs/path/to/repo",
    "resultFilePath": "/abs/path/to/result.json",
    "logFilePath": "/abs/path/to/log.json"
  }
}
```

### Result Envelope (Agent -> Bus)

The agent writes a JSON file to `$AGENT_BUS_RESULT_FILE_PATH`:

**Success** — delivery completes, follow-up events are published:
```json
{
  "schemaVersion": 1,
  "status": "success",
  "summary": "Phase 6 implemented",
  "outputArtifacts": [
    { "path": "docs/design.md", "role": "primary" }
  ],
  "events": [
    {
      "topic": "implement_done",
      "payload": { "branch": "feat/phase-6", "phase": 6 }
    }
  ]
}
```

**Retryable error** — delivery retries after delay:
```json
{
  "schemaVersion": 1,
  "status": "retryable_error",
  "errorMessage": "API rate limited",
  "retryDelayMs": 30000
}
```

**Fatal error** — delivery goes to dead-letter:
```json
{
  "schemaVersion": 1,
  "status": "fatal_error",
  "errorMessage": "Missing required input file"
}
```

### Environment Variables

Every agent process receives:

| Variable | Value |
|----------|-------|
| `AGENT_BUS_SCHEMA_VERSION` | `"1"` |
| `AGENT_BUS_AGENT_ID` | Agent ID from manifest |
| `AGENT_BUS_RUNTIME` | Runtime family |
| `AGENT_BUS_WORK_PACKAGE_PATH` | Path to work package JSON |
| `AGENT_BUS_RESULT_FILE_PATH` | Path to write result JSON |
| `AGENT_BUS_LOG_FILE_PATH` | Path to write log file |
| `AGENT_BUS_MCP_URL` | MCP server URL (if `--mcp-port` set) |
| Custom vars | From `agent.environment` in manifest |

## Identity Files

An identity file gives an agent its role and instructions. It's a markdown file referenced by `identityFile` in the manifest:

```markdown
# Reviewer Agent

You are a code reviewer. Your job is to review pull requests for correctness and style.

## Instructions

1. Read the work package from `$AGENT_BUS_WORK_PACKAGE_PATH`
2. Extract the PR URL from `event.payload.prUrl`
3. Run `gh pr diff <prUrl>` and review the changes
4. Write your review result to `$AGENT_BUS_RESULT_FILE_PATH`
```

The bus resolves the identity file path relative to the repository root and passes it to the adapter, which injects it into the agent's prompt.

## CLI Reference

### Core Commands

```bash
# Start the worker loop (daemon + delivery processing)
agent-bus worker [options]
  --config <path>           # manifest path (default: agent-bus.yaml)
  --worker-id <id>          # unique worker ID (default: worker-<pid>)
  --concurrency <N>         # parallel execution slots (default: 1)
  --lease-duration-ms <N>   # lease timeout (default: 60000)
  --poll-interval-ms <N>    # poll interval (default: 1000)
  --retry-delay-ms <N>      # default retry delay
  --drain-timeout-ms <N>    # graceful shutdown timeout (default: 30000)
  --mcp-port <N>            # enable MCP server on port
  --dashboard-port <N>      # enable dashboard on port
  --log-level <level>       # debug|info|warn|error|fatal
  --once                    # process one delivery and exit
  --verbose                 # stream agent stdout/stderr

# Validate a manifest file
agent-bus validate-manifest <path>

# Show resolved directory layout
agent-bus layout [--config <path>] [--ensure]

# Publish an event from a JSON file
agent-bus publish --envelope <file> [--config <path>]
```

### Operator Commands

```bash
# Runs
agent-bus runs list [--limit N] [--json]
agent-bus runs show <run-id> [--json]

# Approvals
agent-bus approvals list [--json]
agent-bus approvals approve <id> --by <actor>
agent-bus approvals reject <id> --by <actor> --feedback "reason"

# Failures
agent-bus failures list [--json]

# Replay
agent-bus replay delivery <delivery-id> [--available-at <iso>]
agent-bus replay event <event-id> [--available-at <iso>]
```

## Example: Multi-Agent Pipeline

Here's a real-world pipeline with three agents — a developer, a shipper, and a reviewer:

```
plan_done ──> developer_codex ──> implement_done ──> shipper_haiku ──> pr_ready ──> reviewer_claude
                (GPT-5.3)            (code done)     (Haiku 4.5)      (PR open)    (Opus 4.6)
```

```yaml
version: 1
workspace:
  artifactsDir: .agent-bus/artifacts
  stateDir: .agent-bus/state
  logsDir: .agent-bus/logs

agents:
  - id: developer_codex
    runtime: codex
    description: Implements code from planning docs.
    identityFile: .agent/identities/developer.md
    command: [codex, exec, --model, gpt-5.3-codex, --full-auto]
    environment:
      CODEX_QUIET: "1"

  - id: shipper_haiku
    runtime: claude-code
    description: Pushes branch and opens GitHub PR.
    identityFile: .agent/identities/shipper.md
    command: [claude, --model, claude-haiku-4-5-20251001]

  - id: reviewer_claude
    runtime: claude-code
    description: Reviews the PR for correctness.
    identityFile: .agent/identities/reviewer.md
    command: [claude, --model, claude-opus-4-6]

subscriptions:
  - agentId: developer_codex
    topic: plan_done

  - agentId: shipper_haiku
    topic: implement_done

  - agentId: reviewer_claude
    topic: pr_ready
```

### Seed Event

Kick off the pipeline by publishing a seed event:

```bash
cat > /tmp/seed.json << 'EOF'
{
  "eventId": "00000000-0000-0000-0000-000000000001",
  "topic": "plan_done",
  "runId": "run-phase-8",
  "correlationId": "run-phase-8",
  "dedupeKey": "plan_done:run-phase-8",
  "occurredAt": "2026-03-17T00:00:00.000Z",
  "producer": {
    "agentId": "human",
    "runtime": "manual"
  },
  "payload": {
    "phase": 8,
    "milestone": "v1.1"
  },
  "artifactRefs": []
}
EOF

agent-bus publish --envelope /tmp/seed.json
```

The bus fans out `plan_done` to `developer_codex`. When Codex finishes, it emits `implement_done`. The bus delivers that to `shipper_haiku`, which pushes and creates a PR, then emits `pr_ready`. Finally `reviewer_claude` picks up the review.

## Setting Up Your Own Workflow

1. **Create `agent-bus.yaml`** at your repo root with workspace paths, agents, and subscriptions.

2. **Create identity files** for each agent — markdown files that tell the agent what to do when it receives a work package.

3. **Initialize directories:**
   ```bash
   agent-bus layout --config agent-bus.yaml --ensure
   ```

4. **Start the worker:**
   ```bash
   agent-bus worker --config agent-bus.yaml --concurrency 2 --dashboard-port 3000
   ```

5. **Publish a seed event** to start the workflow:
   ```bash
   agent-bus publish --envelope my-event.json
   ```

6. **Monitor** via dashboard at `http://localhost:3000` or CLI:
   ```bash
   agent-bus runs list
   agent-bus approvals list
   agent-bus failures list
   ```

## Architecture

```
src/
├── adapters/           # Agent runtime adapters
│   ├── registry.ts     # Runtime family -> command builder mapping
│   ├── contract.ts     # Work package & result envelope schemas
│   ├── process-runner.ts
│   └── vendors/        # codex, claude-code, gemini, open-code
├── cli/                # CLI command handlers
├── config/             # YAML manifest loading & Zod validation
├── daemon/             # Runtime orchestration
│   ├── dispatcher.ts          # Event notification routing
│   ├── publish-event.ts       # Persist event + fan-out
│   ├── subscription-planner.ts # Match events to subscribers
│   ├── delivery-service.ts    # Lease-based claiming & state transitions
│   ├── approval-service.ts    # Manual approval gates
│   ├── adapter-worker.ts      # Spawn agent, process result
│   ├── recovery-scan.ts       # Reclaim expired leases
│   ├── dashboard-server.ts    # Hono HTTP + SSE dashboard
│   └── dashboard-html.ts      # Single-file inline HTML UI
├── domain/             # Core types: EventEnvelope, ArtifactRef
├── shared/             # Runtime layout, path resolution
└── storage/            # SQLite persistence (WAL mode)
    ├── event-store.ts
    ├── delivery-store.ts
    ├── approval-store.ts
    ├── run-store.ts
    └── migrations/     # SQL schema migrations
```

### Storage

SQLite with WAL mode. Four tables: `events`, `deliveries`, `approvals`, `runs` + `event_artifacts` and `schema_migrations`.

Default max attempts: 3. Retry delay set by agent via `retryDelayMs` or by worker via `--retry-delay-ms`.

### Dashboard

Localhost-only Hono server with:
- `GET /` — dark terminal-style HTML UI
- `GET /api/runs`, `/api/runs/:id`, `/api/approvals`, `/api/failures` — JSON APIs
- `GET /events` — SSE stream with snapshot bootstrap + live updates

**Security model:** Binds to `127.0.0.1` only. No authentication. Do not expose via reverse proxy on shared environments.

## Why Agent Bus?

| Concern | Direct Agent Calls | Agent Bus |
|---------|-------------------|-----------|
| Failure handling | Caller owns retry logic | Built-in retry, dead-letter, replay |
| Human gates | Ad hoc | Durable approval gates |
| Audit trail | Scattered logs | Persisted events + deliveries |
| Artifact handoff | Inline text | Repository file references |
| Recovery | Fragile | Restart-safe SQLite state |
| Fan-out | Manual multi-call | Topic subscriptions |
| Observability | None | Live dashboard + CLI |

## Development

```bash
npm run build        # compile TypeScript + copy migrations
npm run typecheck    # type-check without emitting
npm test             # build then run tests (Node 24+ required)
npm run link:global  # install agent-bus binary globally
npm run unlink:global
```

Run a single test:
```bash
node --test dist/test/path/to/file.test.js
```

## Roadmap

- **PostgreSQL storage backend** — swap SQLite for Postgres to enable distributed workers across multiple machines. The protocol stays the same; only the runtime storage layer changes.
- Cloud-native runtime variant (container-based workers, shared Postgres, horizontal scaling)
- Additional adapter vendors (Aider, Continue, custom HTTP agents)
- Auto-approval gates (rule-based, LLM-as-judge)
- Event schema registry and versioning

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2025-2026 rexviet.
