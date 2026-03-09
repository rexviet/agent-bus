import * as path from "node:path";

import type { AgentBusManifest } from "../config/manifest-schema.js";
import { loadManifest } from "../config/load-manifest.js";
import type { EventEnvelope } from "../domain/event-envelope.js";
import { ensureRuntimeLayout, type RuntimeLayout } from "../shared/runtime-layout.js";
import { createEventStore } from "../storage/event-store.js";
import { migrateDatabase } from "../storage/migrate.js";
import { createRunStore } from "../storage/run-store.js";
import {
  DEFAULT_DATABASE_FILENAME,
  openSqliteDatabase
} from "../storage/sqlite-client.js";
import { createDispatcher, type Dispatcher } from "./dispatcher.js";
import { publishEvent } from "./publish-event.js";
import { createRecoveryScan } from "./recovery-scan.js";
import type {
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";

export interface StartDaemonOptions {
  readonly configPath: string;
  readonly repositoryRoot?: string;
  readonly recoveryIntervalMs?: number;
  readonly registerSignalHandlers?: boolean;
  readonly databasePath?: string;
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
  runRecoveryScan(): number;
  dispatcherSnapshot(): ReturnType<Dispatcher["snapshot"]>;
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
  const layout = await ensureRuntimeLayout({ repositoryRoot });
  const databasePath =
    options.databasePath ?? path.resolve(layout.stateDir, DEFAULT_DATABASE_FILENAME);
  const database = openSqliteDatabase({ databasePath });
  const appliedMigrations = await migrateDatabase(database);
  const runStore = createRunStore(database);
  const eventStore = createEventStore(database);
  const dispatcher = createDispatcher();
  const recoveryScan = createRecoveryScan({
    eventStore,
    dispatcher,
    ...(options.recoveryIntervalMs !== undefined
      ? { intervalMs: options.recoveryIntervalMs }
      : {})
  });

  recoveryScan.start();
  recoveryScan.runOnce();

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
        manifest,
        runStore,
        eventStore,
        dispatcher,
        envelope
      });
    },

    runRecoveryScan() {
      return recoveryScan.runOnce();
    },

    dispatcherSnapshot() {
      return dispatcher.snapshot();
    },

    async stop() {
      await stop();
    }
  };
}
