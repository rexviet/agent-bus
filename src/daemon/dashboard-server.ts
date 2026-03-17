import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { DashboardEmitter, DashboardEvent } from "./dispatcher.js";
import { getDashboardHtml } from "./dashboard-html.js";
import type {
  FailureDeliveryView,
  OperatorRunDetail,
  OperatorRunSummary,
  PendingApprovalView
} from "./operator-service.js";

export type { DashboardEmitter } from "./dispatcher.js";

export interface DashboardServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

export interface CreateDashboardServerOptions {
  readonly operatorService: {
    listRunSummaries(limit?: number): OperatorRunSummary[];
    getRunDetail(runId: string): OperatorRunDetail | null;
    listPendingApprovalViews(): PendingApprovalView[];
    listFailureDeliveries(): FailureDeliveryView[];
  };
  readonly dashboardEmitter: DashboardEmitter;
  readonly port?: number;
}

function listenHttpServer(server: http.Server, port?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Dashboard HTTP server did not expose a TCP address."));
        return;
      }

      resolve((address as AddressInfo).port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port ?? 0, "127.0.0.1");
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

export async function createDashboardServer(
  options: CreateDashboardServerOptions
): Promise<DashboardServerHandle> {
  const app = new Hono();
  const activeControllers = new Set<AbortController>();

  app.get("/api/runs", (c) => {
    return c.json(options.operatorService.listRunSummaries(50));
  });

  app.get("/api/runs/:runId", (c) => {
    const detail = options.operatorService.getRunDetail(c.req.param("runId"));

    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }

    return c.json(detail);
  });

  app.get("/api/approvals", (c) => {
    return c.json(options.operatorService.listPendingApprovalViews());
  });

  app.get("/api/failures", (c) => {
    return c.json(options.operatorService.listFailureDeliveries());
  });

  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      activeControllers.add(controller);

      const cleanup = () => {
        activeControllers.delete(controller);
        controller.abort();
      };

      stream.onAbort(cleanup);

      const snapshot = {
        runs: options.operatorService.listRunSummaries(50),
        approvals: options.operatorService.listPendingApprovalViews(),
        failures: options.operatorService.listFailureDeliveries()
      };
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });

      const keepalive = setInterval(() => {
        void stream.writeSSE({ event: "comment", data: "keepalive" });
      }, 30_000);
      keepalive.unref?.();

      await new Promise<void>((resolve) => {
        const handler = (event: DashboardEvent) => {
          void stream.writeSSE({ event: event.type, data: JSON.stringify(event.payload) });
        };
        options.dashboardEmitter.on("dashboard", handler);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearInterval(keepalive);
            options.dashboardEmitter.off("dashboard", handler);
            resolve();
          },
          { once: true }
        );
      });
    });
  });

  app.get("/", (c) => {
    return c.html(getDashboardHtml());
  });

  const httpServer = createAdaptorServer({ fetch: app.fetch as unknown as (request: Request) => Response | Promise<Response> }) as unknown as http.Server;

  try {
    const port = await listenHttpServer(httpServer, options.port);

    return {
      url: `http://127.0.0.1:${port}`,
      async stop() {
        for (const controller of activeControllers) {
          controller.abort();
        }
        activeControllers.clear();
        httpServer.closeAllConnections();
        await closeHttpServer(httpServer);
      }
    };
  } catch (error) {
    await closeHttpServer(httpServer);
    throw error;
  }
}
