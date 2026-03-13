---
trigger: always_on
---

# AI Agent Memory Rules

Use this file as the default memory policy for AI agents working on this project.

## Required Brain

- Always use brain `agent-bus`.
- Replace `agent-bus` with the exact brain name assigned to this project.
- Do not switch to another brain unless the user explicitly instructs you to do so.


## Tool Priority

- Prefer the Neural Memory MCP server for memory operations.
- Use the `nmem` CLI only as a fallback when the Neural Memory MCP server is unavailable, failing, or returning an error that blocks the task.
- When falling back to `nmem` CLI, keep the same brain and tag conventions defined in this file.

## Operational Rules

- Every memory write must use brain `agent-bus`.
- On fallback to CLI, use the same memory routing rules instead of inventing a separate convention.