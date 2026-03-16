import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import {
  EventEnvelopeSchema,
  type EventEnvelope
} from "../domain/event-envelope.js";

export interface McpServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

export interface CreateMcpServerOptions {
  readonly publishEvent: (envelope: EventEnvelope) => void;
  readonly port?: number;
}

function listenHttpServer(
  server: http.Server,
  options: Pick<CreateMcpServerOptions, "port">
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("MCP HTTP server did not expose a TCP address."));
        return;
      }

      resolve((address as AddressInfo).port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, "127.0.0.1");
  });
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function createMcpServer(
  options: CreateMcpServerOptions
): Promise<McpServerHandle> {
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

        return {
          content: [{ type: "text" as const, text: "ok" }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        return {
          isError: true,
          content: [{ type: "text" as const, text: message }]
        };
      }
    }
  );

  const httpServer = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end("Method Not Allowed");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname !== "/mcp") {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }

    const transport = new StreamableHTTPServerTransport();

    try {
      await mcpServer.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Internal Server Error");
      }
    } finally {
      await transport.close();
    }
  });

  try {
    const port = await listenHttpServer(httpServer, options);
    const url = `http://127.0.0.1:${port}/mcp`;

    return {
      url,
      async stop() {
        await mcpServer.close();
        await closeHttpServer(httpServer);
      }
    };
  } catch (error) {
    await mcpServer.close();
    await closeHttpServer(httpServer);
    throw error;
  }
}
