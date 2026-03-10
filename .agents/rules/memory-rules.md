---
trigger: always_on
---

# Memory Usage Rules for AI Agents

## 1. Prefer Neural Memory

When an AI Agent needs to **query or store memory**, always prioritize **Neural Memory**.

Repository:  
https://github.com/nhadaututtheky/neural-memory

Neural Memory is the **default memory system** for all agents. Always use with project name for seperate context between projects

---

## 2. Use MCP Server Tools First

Agents should **always use the MCP server tools from `neural-memory`** when interacting with memory.

This includes:
- querying memory
- storing memory
- semantic search
- updating memory

---

## 3. Fallback to CLI if MCP Tools Fail

If MCP tools cannot be used (e.g., **Codex sometimes fails to return stdout when calling neural-memory tools**), agents may fallback to the **`nmem` CLI**.

Use CLI:
`nmem`

---

## 4. Priority Order

Agents must follow this priority:

1. MCP tools from `neural-memory`
2. `nmem` CLI (fallback only)

Do not skip step (1) unless it fails.

---

## 5. Use with project name
Always use neural-memory with project name for seperate context between projects