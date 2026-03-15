import * as path from "node:path";

import type { AgentBusManifest } from "../config/manifest-schema.js";
import { loadManifest } from "../config/load-manifest.js";
import type { EventEnvelope } from "../domain/event-envelope.js";
import { ensureRuntimeLayout, type RuntimeLayout } from "../shared/runtime-layout.js";
import { createApprovalStore } from "../storage/approval-store.js";
import { createDeliveryStore } from "../storage/delivery-store.js";
import { createEventStore } from "../storage/event-store.js";
import { migrateDatabase } from "../storage/migrate.js";
import { createRunStore } from "../storage/run-store.js";
import {
  openSqliteDatabase,
  resolveDefaultDatabasePath
} from "../storage/sqlite-client.js";
import { createApprovalService } from "./approval-service.js";
import {
  createAdapterWorker,
  type AdapterWorkerExecutionResult,
  type AdapterWorkerOptions
} from "./adapter-worker.js";
import type { ProcessMonitorCallbacks } from "../adapters/process-runner.js";
import { createDeliveryService } from "./delivery-service.js";
import { createDispatcher, type Dispatcher } from "./dispatcher.js";
import type { DaemonLogger } from "./logger.js";
import { createOperatorService } from "./operator-service.js";
import { publishEvent } from "./publish-event.js";
import { createRecoveryScan } from "./recovery-scan.js";
import { createReplayService } from "./replay-service.js";
import type {
  ReturnTypeOfCreateApprovalStore,
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

export interface StartDaemonOptions {
  readonly configPath: string;
  readonly repositoryRoot?: string;
  readonly recoveryIntervalMs?: number;
  readonly startRecoveryScan?: boolean;
  readonly runRecoveryScanOnStart?: boolean;
  readonly registerSignalHandlers?: boolean;
  readonly databasePath?: string;
  readonly monitor?: ProcessMonitorCallbacks;
  readonly logger?: DaemonLogger;
}

export interface AgentBusDaemon {
  readonly configPath: string;
  readonly manifest: AgentBusManifest;
  readonly layout: RuntimeLayout;
  readonly databasePath: string;
  publish(envelope: EventEnvelope): ReturnTypeOfCreateEventStore["insertEvent"] extends (
    ...args: never[]
  ) => infer Result
    ? Result
    : never;
  approve(approvalId: string, decidedBy: string): ReturnType<
    ReturnType<typeof createApprovalService>["approve"]
  >;
  reject(
    approvalId: string,
    decidedBy: string,
    feedback?: string
  ): ReturnType<ReturnType<typeof createApprovalService>["reject"]>;
  claimDelivery(
    workerId: string,
    leaseDurationMs: number,
    asOf?: string
  ): ReturnType<ReturnType<typeof createDeliveryService>["claim"]>;
  acknowledgeDelivery(
    deliveryId: string,
    leaseToken: string
  ): ReturnType<ReturnType<typeof createDeliveryService>["acknowledge"]>;
  failDelivery(
    deliveryId: string,
    leaseToken: string,
    errorMessage: string,
    retryDelayMs: number,
    asOf?: string
  ): ReturnType<ReturnType<typeof createDeliveryService>["fail"]>;
  replayDelivery(
    deliveryId: string,
    availableAt?: string
  ): ReturnType<ReturnType<typeof createReplayService>["replayDelivery"]>;
  replayEvent(
    eventId: string,
    availableAt?: string
  ): ReturnType<ReturnType<typeof createReplayService>["replayEvent"]>;
  runRecoveryScan(): number;
  dispatcherSnapshot(): ReturnType<Dispatcher["snapshot"]>;
  listPendingApprovals(): ReturnType<ReturnTypeOfCreateApprovalStore["listPendingApprovals"]>;
  listPendingApprovalViews(): ReturnType<
    ReturnType<typeof createOperatorService>["listPendingApprovalViews"]
  >;
  getApprovalForEvent(eventId: string): ReturnType<
    ReturnTypeOfCreateApprovalStore["getApprovalForEvent"]
  >;
  listRunSummaries(
    limit?: number
  ): ReturnType<ReturnType<typeof createOperatorService>["listRunSummaries"]>;
  getRunDetail(
    runId: string
  ): ReturnType<ReturnType<typeof createOperatorService>["getRunDetail"]>;
  listDeliveriesForEvent(eventId: string): ReturnType<
    ReturnTypeOfCreateDeliveryStore["listDeliveriesForEvent"]
  >;
  listFailureDeliveries(): ReturnType<
    ReturnType<typeof createOperatorService>["listFailureDeliveries"]
  >;
  runWorkerIteration(
    workerId: string,
    leaseDurationMs: number,
    retryDelayMs?: number
  ): Promise<AdapterWorkerExecutionResult | null>;
  stop(): Promise<void>;
}

function registerShutdownHandlers(stop: () => Promise<void>): () => void {
  const handleSignal = (): void => {
    void stop();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  return () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  };
}

export async function startDaemon(
  options: StartDaemonOptions
): Promise<AgentBusDaemon> {
  const absoluteConfigPath = path.resolve(options.configPath);
  const repositoryRoot = options.repositoryRoot ?? path.dirname(absoluteConfigPath);
  const manifest = await loadManifest(absoluteConfigPath);
  const layout = await ensureRuntimeLayout({
    repositoryRoot,
    workspace: manifest.workspace
  });
  const databasePath =
    options.databasePath ??
    resolveDefaultDatabasePath({
      repositoryRoot,
      workspace: manifest.workspace
    });
  const database = openSqliteDatabase({ databasePath });
  await migrateDatabase(database);
  const runStore = createRunStore(database);
  const eventStore = createEventStore(database);
  const approvalStore = createApprovalStore(database);
  const deliveryStore = createDeliveryStore(database);
  const dispatcher = createDispatcher();
  const approvalService = createApprovalService({
    database,
    approvalStore,
    eventStore,
    deliveryStore,
    runStore,
    dispatcher
  });
  const deliveryService = createDeliveryService({
    deliveryStore,
    eventStore,
    runStore,
    dispatcher
  });
  const adapterWorkerOptions: AdapterWorkerOptions = {
    database,
    manifest,
    layout,
    runStore,
    eventStore,
    deliveryStore,
    deliveryService,
    dispatcher,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.monitor ? { monitor: options.monitor } : {})
  };
  const adapterWorker = createAdapterWorker(adapterWorkerOptions);
  const replayService = createReplayService({
    eventStore,
    deliveryStore,
    runStore,
    dispatcher
  });
  const operatorService = createOperatorService({
    runStore,
    eventStore,
    approvalStore,
    deliveryStore
  });
  const recoveryScan = createRecoveryScan({
    approvalStore,
    deliveryStore,
    eventStore,
    runStore,
    dispatcher,
    ...(options.recoveryIntervalMs !== undefined
      ? { intervalMs: options.recoveryIntervalMs }
      : {})
  });

  if (options.startRecoveryScan !== false) {
    recoveryScan.start();
  }

  if (options.runRecoveryScanOnStart !== false) {
    recoveryScan.runOnce();
  }

  let signalCleanup = (): void => {};
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    stopped = true;
    recoveryScan.stop();
    signalCleanup();
    database.close();
  };

  if (options.registerSignalHandlers !== false) {
    signalCleanup = registerShutdownHandlers(stop);
  }

  return {
    configPath: absoluteConfigPath,
    manifest,
    layout,
    databasePath,

    publish(envelope: EventEnvelope) {
      return publishEvent({
        database,
        manifest,
        runStore,
        eventStore,
        deliveryStore,
        dispatcher,
        envelope
      });
    },

    approve(approvalId: string, decidedBy: string) {
      return approvalService.approve({
        approvalId,
        decidedBy
      });
    },

    reject(approvalId: string, decidedBy: string, feedback?: string) {
      return approvalService.reject({
        approvalId,
        decidedBy,
        ...(feedback ? { feedback } : {})
      });
    },

    claimDelivery(workerId: string, leaseDurationMs: number, asOf?: string) {
      return deliveryService.claim({
        workerId,
        leaseDurationMs,
        ...(asOf ? { asOf } : {})
      });
    },

    acknowledgeDelivery(deliveryId: string, leaseToken: string) {
      return deliveryService.acknowledge(deliveryId, leaseToken);
    },

    failDelivery(
      deliveryId: string,
      leaseToken: string,
      errorMessage: string,
      retryDelayMs: number,
      asOf?: string
    ) {
      return deliveryService.fail({
        deliveryId,
        leaseToken,
        errorMessage,
        retryDelayMs,
        ...(asOf ? { asOf } : {})
      });
    },

    replayDelivery(deliveryId: string, availableAt?: string) {
      return replayService.replayDelivery(
        deliveryId,
        availableAt
      );
    },

    replayEvent(eventId: string, availableAt?: string) {
      return replayService.replayEvent(eventId, availableAt);
    },

    runRecoveryScan() {
      return recoveryScan.runOnce();
    },

    dispatcherSnapshot() {
      return dispatcher.snapshot();
    },

    listPendingApprovals() {
      return approvalStore.listPendingApprovals();
    },

    listPendingApprovalViews() {
      return operatorService.listPendingApprovalViews();
    },

    getApprovalForEvent(eventId: string) {
      return approvalStore.getApprovalForEvent(eventId);
    },

    listRunSummaries(limit?: number) {
      return operatorService.listRunSummaries(limit);
    },

    getRunDetail(runId: string) {
      return operatorService.getRunDetail(runId);
    },

    listDeliveriesForEvent(eventId: string) {
      return deliveryStore.listDeliveriesForEvent(eventId);
    },

    listFailureDeliveries() {
      return operatorService.listFailureDeliveries();
    },

    runWorkerIteration(workerId: string, leaseDurationMs: number, retryDelayMs?: number) {
      return adapterWorker.runIteration({
        workerId,
        leaseDurationMs,
        ...(retryDelayMs !== undefined ? { retryDelayMs } : {})
      });
    },

    async stop() {
      await stop();
    }
  };
}
