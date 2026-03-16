import * as assert from "node:assert/strict";
import * as http from "node:http";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createMcpServer } from "../../src/daemon/mcp-server.js";

function buildValidEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "550e8400-e29b-41d4-a716-446655440800",
    topic: "plan_done",
    runId: "run-001",
    correlationId: "run-001",
    dedupeKey: "plan_done:run-001",
    occurredAt: "2026-03-16T00:00:00Z",
    producer: {
      agentId: "agent-1",
      runtime: "codex"
    },
    payload: { answer: 42 },
    payloadMetadata: {},
    artifactRefs: [],
    ...overrides
  };
}

async function withMcpClient<T>(
  url: string,
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: "agent-bus-test-client", version: "1" });

  await client.connect(transport as unknown as Transport);

  try {
    return await callback(client);
  } finally {
    await client.close();
    await transport.close();
  }
}

async function findOpenPort(): Promise<number> {
  const server = http.createServer((_request, response) => {
    response.statusCode = 204;
    response.end();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port."));
        return;
      }

      resolve(address.port);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

test("createMcpServer starts on localhost and exposes /mcp URL", async () => {
  const server = await createMcpServer({
    publishEvent: () => {
      // no-op
    }
  });

  await server.stop();

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
});

test("stop closes the HTTP server", async () => {
  const server = await createMcpServer({
    publishEvent: () => {
      // no-op
    }
  });

  const url = server.url;
  await server.stop();

  await assert.rejects(() => fetch(url), /ECONNREFUSED|fetch failed/);
});

test("publish_event calls callback and returns ok on valid envelope", async () => {
  let capturedRunId: string | undefined;
  const server = await createMcpServer({
    publishEvent: (envelope) => {
      capturedRunId = envelope.runId;
    }
  });

  try {
    const result = await withMcpClient(server.url, (client) =>
      client.callTool({
        name: "publish_event",
        arguments: buildValidEnvelope()
      })
    );
    const payload = result as {
      readonly isError?: boolean;
      readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
    };

    assert.notEqual(payload.isError, true);
    assert.deepEqual(payload.content, [{ type: "text", text: "ok" }]);
    if (!capturedRunId) {
      assert.fail("publishEvent callback was not invoked.");
    }
    assert.equal(capturedRunId, "run-001");
  } finally {
    await server.stop();
  }
});

test("publish_event returns isError on invalid envelope", async () => {
  const server = await createMcpServer({
    publishEvent: () => {
      // no-op
    }
  });

  try {
    const invalidArgs = {
      ...buildValidEnvelope(),
      runId: ""
    };
    const result = await withMcpClient(server.url, (client) =>
      client.callTool({
        name: "publish_event",
        arguments: invalidArgs
      })
    );
    const payload = result as {
      readonly isError?: boolean;
      readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
    };

    assert.equal(payload.isError, true);
    assert.equal(payload.content?.[0]?.type, "text");
    assert.match(payload.content?.[0]?.text ?? "", /runId|Too small/);
  } finally {
    await server.stop();
  }
});

test("publish_event catches callback errors and returns isError", async () => {
  const server = await createMcpServer({
    publishEvent: () => {
      throw new Error("boom");
    }
  });

  try {
    const result = await withMcpClient(server.url, (client) =>
      client.callTool({
        name: "publish_event",
        arguments: buildValidEnvelope()
      })
    );
    const payload = result as {
      readonly isError?: boolean;
      readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
    };

    assert.equal(payload.isError, true);
    assert.equal(payload.content?.[0]?.type, "text");
    assert.match(payload.content?.[0]?.text ?? "", /boom/);
  } finally {
    await server.stop();
  }
});

test("createMcpServer binds to explicit port when provided", async () => {
  const port = await findOpenPort();
  const server = await createMcpServer({
    port,
    publishEvent: () => {
      // no-op
    }
  });

  try {
    assert.equal(server.url, `http://127.0.0.1:${port}/mcp`);
  } finally {
    await server.stop();
  }
});

test("createMcpServer rejects when requested port is already in use", async () => {
  const port = await findOpenPort();
  const firstServer = await createMcpServer({
    port,
    publishEvent: () => {
      // no-op
    }
  });

  try {
    await assert.rejects(
      () =>
        createMcpServer({
          port,
          publishEvent: () => {
            // no-op
          }
        }),
      /EADDRINUSE/
    );
  } finally {
    await firstServer.stop();
  }
});

test("multiple sequential MCP requests are handled successfully", async () => {
  const capturedRunIds: string[] = [];
  const server = await createMcpServer({
    publishEvent: (envelope) => {
      capturedRunIds.push(envelope.runId);
    }
  });

  try {
    await withMcpClient(server.url, (client) =>
      client.callTool({
        name: "publish_event",
        arguments: buildValidEnvelope({ runId: "run-seq-1", dedupeKey: "k1" })
      })
    );
    await withMcpClient(server.url, (client) =>
      client.callTool({
        name: "publish_event",
        arguments: buildValidEnvelope({
          eventId: "550e8400-e29b-41d4-a716-446655440801",
          runId: "run-seq-2",
          correlationId: "run-seq-2",
          dedupeKey: "k2"
        })
      })
    );

    assert.deepEqual(capturedRunIds, ["run-seq-1", "run-seq-2"]);
  } finally {
    await server.stop();
  }
});
