<!-- AUTO-GENERATED from .planning/phases/08-embedded-mcp-server/08-RESEARCH.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 92f94829efe2752568ab09a3d85a53e87e653f196d074249a39fcd11aad79f44. Edit the source file, not this projection. -->

# Phase 8: Embedded MCP Server - Research

**Researched:** 2026-03-16
**Domain:** Model Context Protocol (MCP) HTTP server — `@modelcontextprotocol/sdk`, Node.js `http` module
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Port allocation:** Optional `--mcp-port` CLI flag; falls back to ephemeral `server.listen(0)`. Bind to `127.0.0.1` only.
- **MCP URL banner:** Display in worker startup banner: `mcp: http://127.0.0.1:54321/mcp`. Also log via NDJSON at info level.
- **MCP server design (stateless):** Agent builds the full `EventEnvelope`. MCP `publish_event` tool accepts a full `EventEnvelope`, validates with existing Zod schemas, then calls `publishEvent()`. Server is completely stateless — no delivery context mapping, no session management.
- **Response:** Simple success/error — no eventId or delivery count returned.
- **Identity file integration (MCP-04):** Identity files call `publish_event` via MCP directly using `AGENT_BUS_MCP_URL`. No adapter-level bridging. Result envelope `events` array remains as alternative path (not deprecated in v1.1).
- **SDK choice:** Use `@modelcontextprotocol/sdk` (McpServer + StreamableHTTPServerTransport). Import paths must be verified during research (this document covers that).
- **Derive MCP tool input schema** from existing Zod `EventEnvelope` types to prevent schema drift.
- **Server lifecycle:** Always-on, starts automatically with daemon. Startup order: load manifest → open SQLite → start MCP server → enter poll loop. Shutdown: stop claiming → drain in-flight → close MCP server → close SQLite. If MCP server fails to start, daemon refuses to start (fail hard).
- **`AGENT_BUS_MCP_URL`** injected into every agent process alongside existing `AGENT_BUS_*` vars.

### Claude's Discretion

- Exact file placement for MCP server module (likely `src/daemon/mcp-server.ts`)
- How MCP server instance is threaded through daemon startup options
- `StreamableHTTPServerTransport` configuration details
- Test strategy and fixture design

### Deferred Ideas (OUT OF SCOPE)

- `get_delivery` MCP tool — deferred to v2 (MCP-05)
- `list_artifacts` MCP tool — deferred to v2 (MCP-06)
- `events` array deprecation in result envelope — keep backward-compat in v1.1, deprecate in v1.2
- MCP authentication — not needed for localhost-only v1.1
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Daemon starts an embedded MCP HTTP server on localhost when the daemon starts | SDK lifecycle: `McpServer` + `StreamableHTTPServerTransport` + Node.js `http.createServer`; stateless transport config; automatic start in `startDaemon` |
| MCP-02 | Agent receives `AGENT_BUS_MCP_URL` env var in work package pointing to the MCP server | Add `AGENT_BUS_MCP_URL` to `buildBaseEnvironment()` in `src/adapters/registry.ts`; URL known after `server.listen(0)` resolves port |
| MCP-03 | Agent can call `publish_event` MCP tool to publish follow-up events during execution | `McpServer.registerTool()` with `EventEnvelopeSchema` shape; handler calls existing `publishEvent()`; stateless transport handles HTTP POST at `/mcp` |
| MCP-04 | Agent identity file can use `publish_event` MCP tool instead of writing `events` in result envelope | No adapter changes needed; identity file uses `AGENT_BUS_MCP_URL` env var and MCP client; backward-compat `events` array retained |
</phase_requirements>

---

## Summary

Phase 8 embeds an MCP HTTP server directly in the daemon process. The server exposes a single `publish_event` tool that accepts a full `EventEnvelope`, validates it, and calls the existing `publishEvent()` function. The server is stateless — no session management, no delivery context, no per-connection state.

The `@modelcontextprotocol/sdk` v1.27.1 is the correct library. It ships `McpServer` (high-level tool registration API) and `StreamableHTTPServerTransport` (Node.js-compatible wrapper around a Hono-based web-standards transport). The stateless transport configuration requires passing `sessionIdGenerator: undefined`. The transport's `handleRequest()` method is called from a raw `http.createServer` handler.

The project already uses `zod ^4.3.6`. The MCP SDK peer-accepts `zod ^3.25 || ^4.0` and its transitive dependency resolves to `zod 4.3.6` — the same version already in the project. No version conflict. The `EventEnvelopeSchema` can be passed directly as the tool's `inputSchema` after extracting its shape with `.shape`.

**Primary recommendation:** Create `src/daemon/mcp-server.ts` that starts an `http.Server` on `127.0.0.1`, creates one `StreamableHTTPServerTransport` per request (stateless pattern), registers `publish_event` on `McpServer`, and exposes `start(port?)` / `stop()` / `url` interface. Thread it through `StartDaemonOptions` and `AgentBusDaemon`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP server + StreamableHTTP transport | Official Anthropic SDK; only spec-compliant Node.js HTTP MCP transport |
| `node:http` | built-in | HTTP server for listening | No extra dependency; `StreamableHTTPServerTransport.handleRequest()` accepts `IncomingMessage`/`ServerResponse` |
| `zod` | `^4.3.6` (already present) | Schema reuse for tool input validation | `EventEnvelopeSchema.shape` passed as `inputSchema` to `registerTool` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@hono/node-server` | `^1.19.x` (transitive, via MCP SDK) | Node.js HTTP adapter inside `StreamableHTTPServerTransport` | Pulled in automatically — no direct import needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `McpServer` (high-level) | `Server` (low-level) | `Server` is deprecated; `McpServer` is the current recommended API |
| `StreamableHTTPServerTransport` | `SSEServerTransport` | SSE transport is the legacy approach; Streamable HTTP is the current MCP spec |
| ephemeral port + advertise | fixed port | Ephemeral avoids conflicts; `--mcp-port` override satisfies operators with firewall needs |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk@^1.27.1
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/daemon/
├── mcp-server.ts        # New: McpServer + http.Server lifecycle, publish_event tool
├── index.ts             # Modified: start MCP server in startup sequence, expose mcpUrl
├── publish-event.ts     # Unchanged: publishEvent() called by MCP handler
src/adapters/
├── registry.ts          # Modified: buildBaseEnvironment() adds AGENT_BUS_MCP_URL
src/cli/
├── worker-command.ts    # Modified: parse --mcp-port, thread to startDaemon, add to banner
├── output.ts            # Modified: writeWorkerStartedText adds mcpUrl field
test/daemon/
├── mcp-server.test.ts   # New: unit tests for MCP server lifecycle + tool behavior
```

### Pattern 1: Stateless Transport Per Request

**What:** For a stateless MCP server, a new `StreamableHTTPServerTransport` instance must be created for each incoming HTTP request. Each transport connects to the shared `McpServer` instance, processes the request, and is discarded.

**When to use:** Any MCP server that does not need session state (no multi-turn SSE, no persistent client connections). Agent Bus MCP server is stateless by design.

**Why it matters:** If you reuse a single transport instance across requests, the SDK raises errors or silently breaks because it tracks connection state internally.

**Example:**
```typescript
// Source: @modelcontextprotocol/sdk StreamableHTTP stateless pattern (verified from type defs)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from "node:http";

// mcpServer is created once and reused
const mcpServer = new McpServer({ name: "agent-bus", version: "1.0.0" });

// Register tools on mcpServer once at startup (before any requests)

const httpServer = http.createServer((req, res) => {
  if (req.url === "/mcp" && req.method === "POST") {
    // New transport per request — stateless pattern
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined  // undefined = stateless, no session header
    });
    // connect() wires the transport to the McpServer
    mcpServer.connect(transport).then(() => {
      transport.handleRequest(req, res);
    });
  } else {
    res.writeHead(404).end();
  }
});
```

### Pattern 2: Tool Registration with Existing Zod Schema Shape

**What:** `McpServer.registerTool()` accepts a `ZodRawShapeCompat` as `inputSchema` — a `Record<string, ZodTypeAny>`. The `EventEnvelopeSchema.shape` property is exactly this type.

**When to use:** Reusing an existing Zod object schema's shape as MCP tool input. Prevents schema drift.

**Example:**
```typescript
// Source: @modelcontextprotocol/sdk McpServer.registerTool() type signature (verified)
import { EventEnvelopeSchema } from "../domain/event-envelope.js";
import { z } from "zod";

mcpServer.registerTool(
  "publish_event",
  {
    description: "Publish a follow-up event into Agent Bus during agent execution.",
    inputSchema: EventEnvelopeSchema.shape  // ZodRawShapeCompat — exact type match
  },
  async (args) => {
    // args is typed as z.infer<typeof EventEnvelopeSchema>
    const envelope = EventEnvelopeSchema.parse(args);  // validate + coerce defaults
    try {
      publishEvent({ database, manifest, runStore, eventStore, deliveryStore, dispatcher, envelope });
      return { content: [{ type: "text", text: "ok" }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "publish failed" }]
      };
    }
  }
);
```

### Pattern 3: Ephemeral Port Discovery

**What:** `server.listen(0)` lets the OS assign a free port. The actual port is readable from `server.address()` after the `listening` event.

**When to use:** Default mode when `--mcp-port` is not specified.

**Example:**
```typescript
// Source: Node.js built-in net/http (HIGH confidence, standard pattern)
await new Promise<void>((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(port ?? 0, "127.0.0.1", () => resolve());
});
const address = httpServer.address();
// address is AddressInfo when bound to IP+port
const mcpUrl = `http://127.0.0.1:${(address as AddressInfo).port}/mcp`;
```

### Pattern 4: MCP Server Module Interface

**What:** `mcp-server.ts` exports a factory function returning a handle with `start()`, `stop()`, and `url` getter. The daemon threads this through `StartDaemonOptions` to keep dependency injection consistent with existing patterns.

**Example:**
```typescript
// Pattern derived from existing DI via options objects in daemon/index.ts
export interface McpServerHandle {
  readonly url: string;  // available after start() resolves
  stop(): Promise<void>;
}

export interface CreateMcpServerOptions {
  readonly publishEvent: (envelope: EventEnvelope) => void;
  readonly port?: number;  // undefined = ephemeral
}

export async function createMcpServer(options: CreateMcpServerOptions): Promise<McpServerHandle> {
  // ...
}
```

### Anti-Patterns to Avoid

- **Reusing transport instance across requests:** The `StreamableHTTPServerTransport` is stateful per-connection internally. Always create a new transport per HTTP request in stateless mode.
- **Calling `mcpServer.connect(transport)` once for the server lifetime:** Only valid for a single persistent connection (stdio). For HTTP, connect is per-request.
- **Using the deprecated `Server` class directly:** `McpServer` is the recommended high-level API as of SDK v1.x. `Server` is now `@deprecated`.
- **Using `SSEServerTransport`:** This is the legacy transport. `StreamableHTTPServerTransport` implements the current MCP Streamable HTTP spec.
- **Calling `publishEvent()` without wrapping in try/catch:** SQLite write errors should return `isError: true` to the MCP client, not crash the HTTP handler.
- **Starting MCP server after the poll loop:** Startup order matters. MCP server must be running before `AGENT_BUS_MCP_URL` is available for agent env vars.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol framing | Custom JSON-RPC HTTP handler | `McpServer` + `StreamableHTTPServerTransport` | Protocol has initialization handshake, capability negotiation, error codes — all handled by SDK |
| Tool input validation | Duplicate Zod schema | `EventEnvelopeSchema.shape` as `inputSchema` | SDK validates and types the input; schema drift risk if duplicated |
| SSE streaming / HTTP chunking | Custom stream management | `StreamableHTTPServerTransport.handleRequest()` | Transport handles `Content-Type: text/event-stream` negotiation, chunked encoding |
| Session ID generation | Custom UUID logic | `sessionIdGenerator: undefined` (stateless) | Stateless mode eliminates session management entirely |

**Key insight:** The MCP SDK handles all protocol-level complexity — JSON-RPC envelope, initialization exchange, error serialization, and HTTP streaming. The application layer (Agent Bus) only needs to register tools and implement their handlers.

---

## Common Pitfalls

### Pitfall 1: Transport Instance Reuse in Stateless Mode

**What goes wrong:** Using a single `StreamableHTTPServerTransport` instance for multiple requests causes the second request to fail with a transport state error.

**Why it happens:** The transport tracks internal connection state (e.g., whether `start()` has been called). A new request arriving after a previous one completed finds the transport in a closed state.

**How to avoid:** Create a new `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` for every incoming POST request.

**Warning signs:** Second MCP call from an agent returns a transport error instead of tool result.

### Pitfall 2: McpServer connect() vs tool registration order

**What goes wrong:** Registering tools after calling `mcpServer.connect(transport)` — tools may not be advertised in the initialization response.

**Why it happens:** `McpServer` builds the capabilities list at `connect()` time based on which tools are registered.

**How to avoid:** Register all tools on `McpServer` at module initialization time, before any `connect()` call. In the Agent Bus implementation: register `publish_event` during `createMcpServer()`, not inside the HTTP request handler.

**Warning signs:** MCP client's `tools/list` returns empty array; agent cannot find `publish_event`.

### Pitfall 3: MCP URL not available before buildBaseEnvironment() runs

**What goes wrong:** `AGENT_BUS_MCP_URL` is not set if the MCP server's port isn't known when `buildBaseEnvironment()` is called.

**Why it happens:** Ephemeral port is only assigned after `server.listen()` completes. If `buildAdapterCommand()` runs before `mcp-server.ts` has finished binding, the URL is undefined.

**How to avoid:** The MCP server is started in `startDaemon()` before the daemon object is returned. The `mcpUrl` is passed into `buildBaseEnvironment()` as an argument to `buildAdapterCommand()` or threaded through `AdapterWorkerOptions`. The URL is known at daemon construction time, before any worker iteration.

**Warning signs:** `AGENT_BUS_MCP_URL` is `undefined` in agent env vars; agent identity file cannot connect to MCP server.

### Pitfall 4: Zod Schema Shape Compatibility

**What goes wrong:** Passing `EventEnvelopeSchema` (a `ZodObject`) directly as `inputSchema` instead of `EventEnvelopeSchema.shape` (a `ZodRawShapeCompat`).

**Why it happens:** `McpServer.registerTool()` `inputSchema` expects `ZodRawShapeCompat = Record<string, AnySchema>`, not a full `ZodObject`. A `ZodObject` does not satisfy this type.

**How to avoid:** Use `EventEnvelopeSchema.shape` — this is the raw `{ eventId: ZodString, topic: ZodString, ... }` record.

**Warning signs:** TypeScript compile error on `registerTool()` call.

### Pitfall 5: SQLite Synchronous Calls in Async HTTP Handler

**What goes wrong:** `publishEvent()` is synchronous (uses `DatabaseSync`). The HTTP request handler is async. If the tool handler throws synchronously, the error propagates as a rejected Promise and may not be caught by the MCP SDK's error handling.

**Why it happens:** `DatabaseSync` methods throw synchronously on constraint violations or schema errors. In an async context, synchronous throws inside `async` functions are automatically converted to rejected promises — but only if inside a `try/catch` or an awaited call.

**How to avoid:** Wrap `publishEvent()` in try/catch inside the `async` tool handler. Return `{ isError: true, content: [...] }` on error rather than rethrowing.

---

## Code Examples

Verified patterns from SDK type definitions and Node.js built-ins:

### McpServer and transport import paths (VERIFIED against SDK v1.27.1)
```typescript
// Source: @modelcontextprotocol/sdk package.json exports map
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
```

### Stateless transport configuration
```typescript
// Source: StreamableHTTPServerTransport type def (verified)
// sessionIdGenerator: undefined  → stateless mode, no Mcp-Session-Id header
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined
});
```

### Tool handler return value
```typescript
// Source: CallToolResult type in @modelcontextprotocol/sdk/dist/esm/types.d.ts (verified)
// Success case:
return { content: [{ type: "text", text: "ok" }] };
// Error case (protocol-level error reported to client, not HTTP 500):
return { isError: true, content: [{ type: "text", text: "reason" }] };
```

### Complete mcp-server.ts sketch
```typescript
// File: src/daemon/mcp-server.ts
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { EventEnvelopeSchema, type EventEnvelope } from "../domain/event-envelope.js";

export interface McpServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

export async function createMcpServer(options: {
  publishEvent: (envelope: EventEnvelope) => void;
  port?: number;
}): Promise<McpServerHandle> {
  const mcpServer = new McpServer({ name: "agent-bus", version: "1" });

  mcpServer.registerTool(
    "publish_event",
    {
      description: "Publish a follow-up event into Agent Bus during agent execution.",
      inputSchema: EventEnvelopeSchema.shape
    },
    async (args) => {
      try {
        const envelope = EventEnvelopeSchema.parse(args);
        options.publishEvent(envelope);
        return { content: [{ type: "text" as const, text: "ok" }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : "publish failed" }]
        };
      }
    }
  );

  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      void mcpServer.connect(transport).then(() => transport.handleRequest(req, res));
    } else {
      res.writeHead(405).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, "127.0.0.1", resolve);
  });

  const address = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/mcp`;

  return {
    url,
    async stop() {
      await mcpServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
```

### Adding AGENT_BUS_MCP_URL to buildBaseEnvironment
```typescript
// File: src/adapters/registry.ts — buildBaseEnvironment()
// mcpUrl is threaded from AdapterWorkerOptions (new optional field)
function buildBaseEnvironment(
  input: BuildAdapterCommandInput,
  mcpUrl?: string
): Record<string, string> {
  return {
    ...input.agent.environment,
    AGENT_BUS_SCHEMA_VERSION: "1",
    AGENT_BUS_AGENT_ID: input.agent.id,
    AGENT_BUS_RUNTIME: input.agent.runtime,
    AGENT_BUS_WORK_PACKAGE_PATH: input.workPackagePath,
    AGENT_BUS_RESULT_FILE_PATH: input.resultFilePath,
    AGENT_BUS_LOG_FILE_PATH: input.logFilePath,
    ...(mcpUrl ? { AGENT_BUS_MCP_URL: mcpUrl } : {})
  };
}
```

### writeWorkerStartedText extension
```typescript
// File: src/cli/output.ts — extend options type + output
// Add optional mcpUrl to the options object, print only when present
if (options.mcpUrl !== undefined) {
  writeLine(stream, `mcp: ${options.mcpUrl}`);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `SSEServerTransport` | `StreamableHTTPServerTransport` | MCP spec 2025-03-26 | Streamable HTTP replaces SSE-only transport; SDK v1.x ships both but SSE is legacy |
| `Server` (low-level class) | `McpServer` (high-level) | SDK v1.0 | `Server` is now `@deprecated`; `McpServer` provides `registerTool()` / `registerResource()` etc. |
| `tool()` method on `McpServer` | `registerTool()` method | SDK v1.x | `tool()` overloads are `@deprecated`; use `registerTool()` |

**Deprecated/outdated:**
- `SSEServerTransport`: Legacy transport, not for new implementations
- `McpServer.tool()`: All overloads marked `@deprecated`; use `registerTool()` with config object
- `Server` class: `@deprecated`; only for advanced protocol customization

---

## Open Questions

1. **`connect()` lifecycle with per-request transports**
   - What we know: `McpServer.connect(transport)` wires a transport and starts listening. The SDK docs show one transport per server for persistent connections.
   - What's unclear: Whether calling `connect()` per request leaks event listeners or accumulates internal state on `McpServer`. The `McpServer.close()` method closes all connected transports.
   - Recommendation: In the test, verify that 10+ sequential POST requests to the MCP server all succeed, and that `mcpServer.close()` cleanly shuts down.

2. **Error handling when `publishEvent()` throws a duplicate dedupeKey error**
   - What we know: `EventStore.insertEvent()` enforces a UNIQUE constraint on `dedupeKey`. A duplicate causes a SQLite constraint error thrown synchronously.
   - What's unclear: Whether the MCP client (agent) retries on `isError: true` or treats it as fatal.
   - Recommendation: Return `isError: true` with a clear message. Agents that construct `dedupeKey` from event data naturally avoid duplicates.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no version — built into Node 22.12+) |
| Config file | none — tests run via `npm test` which executes `node --experimental-sqlite --test dist/test/**/*.test.js` |
| Quick run command | `npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | Daemon starts MCP HTTP server on localhost | unit | `node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` | ❌ Wave 0 |
| MCP-01 | Server fails hard if port conflict on startup | unit | same file | ❌ Wave 0 |
| MCP-02 | `AGENT_BUS_MCP_URL` present in agent env vars | unit | `node --experimental-sqlite --test dist/test/adapters/registry.test.js` | ❌ Wave 0 |
| MCP-02 | Worker startup banner includes `mcp:` line | unit | `node --experimental-sqlite --test dist/test/cli/worker-command.test.js` | ✅ (extend existing) |
| MCP-03 | `publish_event` tool stores event in event store | unit | `node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` | ❌ Wave 0 |
| MCP-03 | `publish_event` tool returns error on invalid envelope | unit | same file | ❌ Wave 0 |
| MCP-04 | `events` array still works alongside MCP path | unit | existing `adapter-worker.test.ts` (verify not broken) | ✅ (verify unchanged) |

### Sampling Rate
- **Per task commit:** `npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/daemon/mcp-server.test.ts` — covers MCP-01, MCP-03
- [ ] `test/adapters/registry.test.ts` — covers MCP-02 (AGENT_BUS_MCP_URL in env)

*(Existing `test/cli/worker-command.test.ts` covers MCP-02 banner; extend in-place. No new framework install needed.)*

---

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk` v1.27.1 — verified by `npm info` and local inspection of `dist/esm/server/mcp.d.ts`, `streamableHttp.d.ts`, `webStandardStreamableHttp.d.ts`, `zod-compat.d.ts`, `package.json`
- Node.js `node:http` built-in — standard Node.js 22.12+ API, no version uncertainty
- `src/domain/event-envelope.ts` — `EventEnvelopeSchema.shape` type confirmed as `Record<string, ZodType>` compatible with `ZodRawShapeCompat`
- `src/adapters/registry.ts` — `buildBaseEnvironment()` signature and location confirmed by direct read
- `src/daemon/index.ts` — `StartDaemonOptions` and `AgentBusDaemon` interface confirmed; DI pattern via options objects confirmed
- `src/cli/worker-command.ts` — `--mcp-port` pattern, `parseIntegerAtLeast` reuse, `writeWorkerStartedText` call site confirmed

### Secondary (MEDIUM confidence)
- MCP Streamable HTTP spec (2025-03-26) — stateless transport pattern derived from SDK type annotations and `WebStandardStreamableHTTPServerTransportOptions` docs

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDK version confirmed from npm; import paths verified from installed package dist
- Architecture: HIGH — stateless transport pattern derived directly from SDK type definitions; DI pattern derived from existing codebase
- Pitfalls: HIGH — transport reuse and tool registration order derived from SDK internals; schema shape pitfall confirmed from TypeScript types
- Zod compatibility: HIGH — MCP SDK peer dep is `zod ^3.25 || ^4.0`; transitive install resolved to same `zod 4.3.6` already in project

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (SDK v1.x is stable; check for minor version bumps before install)
