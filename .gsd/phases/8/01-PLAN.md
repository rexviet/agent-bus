---
phase: 8
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/daemon/mcp-server.ts
  - test/daemon/mcp-server.test.ts
autonomous: true
requirements:
  - MCP-01
  - MCP-03

must_haves:
  truths:
    - "MCP HTTP server starts on 127.0.0.1 and returns a URL with the bound port"
    - "MCP HTTP server stops cleanly when stop() is called"
    - "publish_event tool validates EventEnvelope and calls publishEvent callback on valid input"
    - "publish_event tool returns isError:true on invalid envelope"
    - "MCP server fails to start when port is already in use"
  artifacts:
    - path: "src/daemon/mcp-server.ts"
      provides: "MCP server factory with start/stop lifecycle and publish_event tool"
      exports: ["createMcpServer", "McpServerHandle"]
    - path: "test/daemon/mcp-server.test.ts"
      provides: "Unit tests for MCP server lifecycle and publish_event tool"
      min_lines: 80
  key_links:
    - from: "src/daemon/mcp-server.ts"
      to: "src/domain/event-envelope.ts"
      via: "EventEnvelopeSchema.shape as inputSchema for registerTool"
      pattern: "EventEnvelopeSchema\\.shape"
    - from: "src/daemon/mcp-server.ts"
      to: "publishEvent callback"
      via: "options.publishEvent(envelope) inside tool handler"
      pattern: "options\\.publishEvent"
---
<!-- AUTO-GENERATED from .planning/phases/08-embedded-mcp-server/08-01-PLAN.md by scripts/sync-planning-to-gsd.mjs. source-sha256: 8171aa2cdc1f5cd99ca94fc86ac9e84a473ccc07e136879a056cfff7bc9e1bf4. Edit the source file, not this projection. -->


<objective>
Create the standalone MCP server module that exposes a `publish_event` tool over HTTP, and install the MCP SDK dependency.

Purpose: This is the core new component for Phase 8 -- a stateless MCP HTTP server that agents call to publish follow-up events. It must work independently before being wired into the daemon lifecycle (Plan 02).

Output: `src/daemon/mcp-server.ts` with `createMcpServer()` factory, `test/daemon/mcp-server.test.ts` with lifecycle and tool tests, `@modelcontextprotocol/sdk` installed.
</objective>

<execution_context>
@/Users/macbook/.claude/get-shit-done/workflows/execute-plan.md
@/Users/macbook/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.gsd/SPEC.md
@.gsd/ROADMAP.md
@.gsd/STATE.md
@.gsd/phases/8/CONTEXT.md
@.gsd/phases/8/RESEARCH.md

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->

From src/domain/event-envelope.ts:
```typescript
export const EventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  topic: TopicSchema,
  runId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  dedupeKey: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  producer: ProducerSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadMetadata: z.record(z.string(), z.unknown()).default({}),
  artifactRefs: z.array(ArtifactRefSchema).default([])
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
```

From @modelcontextprotocol/sdk (verified in RESEARCH.md):
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// McpServer.registerTool(name, config, handler)
// config.inputSchema expects ZodRawShapeCompat = Record<string, AnySchema>
// Use EventEnvelopeSchema.shape (not the full ZodObject)

// StreamableHTTPServerTransport({ sessionIdGenerator: undefined }) = stateless mode
// New transport per POST request (stateless pattern)
// mcpServer.connect(transport) then transport.handleRequest(req, res)
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install MCP SDK and create mcp-server.ts module</name>
  <files>package.json, src/daemon/mcp-server.ts, test/daemon/mcp-server.test.ts</files>
  <behavior>
    - Test: createMcpServer() starts HTTP server on 127.0.0.1 and returns url matching http://127.0.0.1:{port}/mcp
    - Test: stop() closes the HTTP server (subsequent HTTP request fails with ECONNREFUSED)
    - Test: publish_event tool with valid EventEnvelope calls the publishEvent callback and returns { content: [{ type: "text", text: "ok" }] }
    - Test: publish_event tool with invalid envelope (missing required field) returns { isError: true, content: [...] }
    - Test: publish_event tool catches synchronous throw from publishEvent callback and returns isError:true
    - Test: createMcpServer({ port: N }) binds to the specified port (use a known free port)
    - Test: createMcpServer() with port conflict (bind same port twice) rejects with error
    - Test: Multiple sequential POST requests succeed (verifies transport-per-request pattern works)
  </behavior>
  <action>
    1. Install SDK: `npm install @modelcontextprotocol/sdk@^1.27.1`

    2. Create `src/daemon/mcp-server.ts`:
       - Export `McpServerHandle` interface: `{ readonly url: string; stop(): Promise<void>; }`
       - Export `CreateMcpServerOptions` interface: `{ readonly publishEvent: (envelope: EventEnvelope) => void; readonly port?: number; }`
       - Export `async function createMcpServer(options: CreateMcpServerOptions): Promise<McpServerHandle>`
       - Inside createMcpServer:
         a. Create `new McpServer({ name: "agent-bus", version: "1" })`
         b. Register `publish_event` tool using `mcpServer.registerTool("publish_event", { description: "Publish a follow-up event into Agent Bus during agent execution.", inputSchema: EventEnvelopeSchema.shape }, handler)`. Register BEFORE any connect() calls (per RESEARCH.md pitfall 2).
         c. Handler: wrap in try/catch. Parse args with `EventEnvelopeSchema.parse(args)`, call `options.publishEvent(envelope)`, return `{ content: [{ type: "text" as const, text: "ok" }] }`. On error return `{ isError: true, content: [{ type: "text" as const, text: error.message }] }`.
         d. Create `http.createServer()`. On POST requests: create new `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request (stateless pattern -- DO NOT reuse transport instances), then `await mcpServer.connect(transport)`, then `transport.handleRequest(req, res)`. On non-POST: respond 405.
         e. Listen: `httpServer.listen(options.port ?? 0, "127.0.0.1")` wrapped in Promise. Get actual port from `httpServer.address() as AddressInfo`.
         f. Return `{ url: "http://127.0.0.1:${port}/mcp", async stop() { await mcpServer.close(); await new Promise(resolve => httpServer.close(resolve)); } }`

    3. Create `test/daemon/mcp-server.test.ts`:
       - Import `createMcpServer` from the module
       - Use `@modelcontextprotocol/sdk/client/index.js` `Client` class and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js` to make real MCP calls against the started server
       - If MCP client imports are problematic, fall back to raw HTTP POST with proper JSON-RPC envelope for the `tools/call` method. The RESEARCH.md confirms the server handles standard JSON-RPC over HTTP.
       - Each test: create server with a mock publishEvent callback (spy/counter), run test, call stop() in afterEach
       - For the port conflict test: start two servers on the same port, expect the second to reject

    NOTE on imports: Use the verified import paths from RESEARCH.md:
    - `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`
    - `import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";`

    NOTE on Zod: The project uses zod ^4.3.6. The MCP SDK peer-accepts zod ^3.25 || ^4.0. Use `EventEnvelopeSchema.shape` directly as `inputSchema` -- it is type-compatible with `ZodRawShapeCompat`.
  </action>
  <verify>
    <automated>npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js</automated>
  </verify>
  <done>
    - `@modelcontextprotocol/sdk` installed in package.json
    - `src/daemon/mcp-server.ts` exports `createMcpServer` and `McpServerHandle`
    - All mcp-server tests pass: lifecycle (start/stop), publish_event success, publish_event validation error, publish_event callback error, port conflict, multiple sequential requests
    - `npm run typecheck` passes
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` passes with new module
- `npm run build && node --experimental-sqlite --test dist/test/daemon/mcp-server.test.js` all pass
- `npm test` full suite still passes (no regressions)
</verification>

<success_criteria>
- MCP server starts on ephemeral port and returns URL
- publish_event tool validates and calls through to callback
- Invalid envelopes return isError:true
- Server stops cleanly
- Port conflict causes hard failure
</success_criteria>

<output>
After completion, create `.gsd/phases/8/01-SUMMARY.md`
</output>
