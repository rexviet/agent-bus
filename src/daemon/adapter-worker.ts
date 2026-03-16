import * as path from "node:path";

import type { DatabaseSync } from "node:sqlite";
import type { Buffer } from "node:buffer";

import {
  createAdapterWorkPackage,
  type AdapterResultEnvelope,
  type EmittedEventDraft
} from "../adapters/contract.js";
import { buildAdapterCommand } from "../adapters/registry.js";
import {
  materializeAdapterRun,
  runPreparedAdapterCommand,
  type ProcessMonitorCallbacks
} from "../adapters/process-runner.js";
import type { AgentBusManifest } from "../config/manifest-schema.js";
import type { RuntimeLayout } from "../shared/runtime-layout.js";
import type { PersistedDeliveryRecord } from "../storage/delivery-store.js";
import type { PersistedEventRecord } from "../storage/event-store.js";
import {
  buildFollowUpEventEnvelope,
  dispatchPublishedEvent,
  persistPublishedEvent
} from "./publish-event.js";
import { planSubscriptionsForTopic } from "./subscription-planner.js";
import type { DaemonLogger } from "./logger.js";
import type {
  ReturnTypeOfCreateDeliveryStore,
  ReturnTypeOfCreateEventStore,
  ReturnTypeOfCreateRunStore
} from "./types.js";
import type { Dispatcher } from "./dispatcher.js";

interface DeliveryServiceShape {
  claim(input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly asOf?: string;
  }): PersistedDeliveryRecord | null;
  acknowledge(
    deliveryId: string,
    leaseToken: string
  ): PersistedDeliveryRecord;
  fail(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly errorMessage: string;
    readonly retryDelayMs: number;
    readonly asOf?: string;
  }): PersistedDeliveryRecord;
  deadLetter(input: {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly errorMessage: string;
    readonly asOf?: string;
  }): PersistedDeliveryRecord;
}

export interface RunWorkerIterationInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly retryDelayMs?: number;
  readonly asOf?: string;
}

export interface AdapterWorkerExecutionResult {
  readonly status:
    | AdapterResultEnvelope["status"]
    | "process_error";
  readonly delivery: PersistedDeliveryRecord;
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly emittedEvents: PersistedEventRecord[];
}

export interface AdapterWorkerOptions {
  readonly database: DatabaseSync;
  readonly manifest: AgentBusManifest;
  readonly layout: RuntimeLayout;
  readonly runStore: ReturnTypeOfCreateRunStore;
  readonly eventStore: ReturnTypeOfCreateEventStore;
  readonly deliveryStore: ReturnTypeOfCreateDeliveryStore;
  readonly deliveryService: DeliveryServiceShape;
  readonly dispatcher: Dispatcher;
  readonly mcpUrl?: string;
  readonly defaultRetryDelayMs?: number;
  readonly monitor?: ProcessMonitorCallbacks;
  readonly verboseMonitorFactory?: (agentId: string) => ProcessMonitorCallbacks;
  readonly logger?: DaemonLogger;
}

function mergeProcessMonitors(
  ...monitors: ReadonlyArray<ProcessMonitorCallbacks | undefined>
): ProcessMonitorCallbacks | undefined {
  const activeMonitors = monitors.filter(
    (monitor): monitor is ProcessMonitorCallbacks => monitor !== undefined
  );
  const timeoutMs = activeMonitors.findLast(
    (monitor) => monitor.timeoutMs !== undefined
  )?.timeoutMs;

  if (activeMonitors.length === 0) {
    return undefined;
  }

  const mergedCallbacks = {
    onStdout: (chunk: Buffer) => {
      for (const monitor of activeMonitors) {
        monitor.onStdout?.(chunk);
      }
    },
    onStderr: (chunk: Buffer) => {
      for (const monitor of activeMonitors) {
        monitor.onStderr?.(chunk);
      }
    },
    onStart: (info: { pid: number; command: string; startedAt: Date }) => {
      for (const monitor of activeMonitors) {
        monitor.onStart?.(info);
      }
    },
    onComplete: (info: {
      pid: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      elapsedMs: number;
    }) => {
      for (const monitor of activeMonitors) {
        monitor.onComplete?.(info);
      }
    }
  };

  return timeoutMs !== undefined
    ? {
        ...mergedCallbacks,
        timeoutMs
      }
    : mergedCallbacks;
}

function extractLeaseConflictDeliveryId(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^Failed to claim delivery ([^.\s]+)\.?$/);

  return match?.[1] ?? null;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function buildRunDirectory(
  layout: RuntimeLayout,
  delivery: PersistedDeliveryRecord
): {
  readonly runDirectory: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
} {
  const safeRunName = sanitizePathSegment(
    `${delivery.deliveryId}-attempt-${delivery.attemptCount}`
  );
  const runDirectory = path.join(layout.stateDir, "adapter-runs", safeRunName);
  const resultFilePath = path.join(runDirectory, "result.json");
  const logFilePath = path.join(layout.logsDir, "adapter-runs", `${safeRunName}.log`);

  return {
    runDirectory,
    resultFilePath,
    logFilePath
  };
}

function getManifestAgent(
  manifest: AgentBusManifest,
  agentId: string
): AgentBusManifest["agents"][number] {
  const agent = manifest.agents.find((item) => item.id === agentId);

  if (!agent) {
    throw new Error(`Manifest agent not found for delivery target ${agentId}.`);
  }

  return agent;
}

function getRequiredArtifacts(
  manifest: AgentBusManifest,
  event: PersistedEventRecord,
  agentId: string
) {
  const subscription = planSubscriptionsForTopic(manifest, event.topic).find(
    (item) => item.agentId === agentId
  );

  return subscription?.requiredArtifacts ?? [];
}

function assertRequiredArtifactsPresent(
  event: PersistedEventRecord,
  requiredArtifacts: ReadonlyArray<{ readonly path: string }>
): void {
  const availableArtifacts = new Set(event.artifactRefs.map((artifact) => artifact.path));

  for (const artifact of requiredArtifacts) {
    if (!availableArtifacts.has(artifact.path)) {
      throw new Error(
        `Required artifact ${artifact.path} is missing from event ${event.eventId}.`
      );
    }
  }
}

function isFatalSetupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException).code;

  return (
    code === "ENOENT" ||
    message.includes("Manifest agent not found") ||
    message.includes("Persisted event not found") ||
    message.includes("Required artifact")
  );
}

interface WorkerResultPaths {
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
}

function buildWorkerExecutionResult(
  status: AdapterWorkerExecutionResult["status"],
  delivery: PersistedDeliveryRecord,
  resultPaths: WorkerResultPaths,
  emittedEvents: readonly PersistedEventRecord[] = []
): AdapterWorkerExecutionResult {
  return {
    status,
    delivery,
    workPackagePath: resultPaths.workPackagePath,
    resultFilePath: resultPaths.resultFilePath,
    logFilePath: resultPaths.logFilePath,
    emittedEvents: [...emittedEvents]
  };
}

function currentDeliveryLostLease(
  deliveryStore: Pick<ReturnTypeOfCreateDeliveryStore, "getDelivery">,
  deliveryId: string,
  leaseToken: string
): PersistedDeliveryRecord | null {
  const currentDelivery = deliveryStore.getDelivery(deliveryId);

  if (!currentDelivery) {
    return null;
  }

  return currentDelivery.status === "leased" && currentDelivery.leaseToken === leaseToken
    ? null
    : currentDelivery;
}

function finalizeLeaseBoundTransition(
  options: Pick<AdapterWorkerOptions, "deliveryStore"> & {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly resultPaths: WorkerResultPaths;
    readonly transitionStatus: AdapterWorkerExecutionResult["status"];
    readonly transition: () => PersistedDeliveryRecord;
  }
): AdapterWorkerExecutionResult {
  const staleLeaseDelivery = currentDeliveryLostLease(
    options.deliveryStore,
    options.deliveryId,
    options.leaseToken
  );

  if (staleLeaseDelivery) {
    return buildWorkerExecutionResult(
      "process_error",
      staleLeaseDelivery,
      options.resultPaths
    );
  }

  try {
    return buildWorkerExecutionResult(
      options.transitionStatus,
      options.transition(),
      options.resultPaths
    );
  } catch (error) {
    const currentDelivery = currentDeliveryLostLease(
      options.deliveryStore,
      options.deliveryId,
      options.leaseToken
    );

    if (currentDelivery) {
      return buildWorkerExecutionResult("process_error", currentDelivery, options.resultPaths);
    }

    throw error;
  }
}

function publishEmittedEventsAndAcknowledge(
  options: Pick<
    AdapterWorkerOptions,
    "database" | "manifest" | "runStore" | "eventStore" | "deliveryStore" | "dispatcher"
  > & {
    readonly deliveryId: string;
    readonly leaseToken: string;
    readonly drafts: readonly EmittedEventDraft[];
    readonly sourceEvent: PersistedEventRecord;
    readonly producer: {
      readonly agentId: string;
      readonly runtime: string;
      readonly model?: string;
    };
    readonly defaultArtifactRefs: PersistedEventRecord["artifactRefs"];
  },
  resultPaths: WorkerResultPaths
): AdapterWorkerExecutionResult {
  const emittedEvents: PersistedEventRecord[] = [];
  const dispatchQueue: Parameters<typeof dispatchPublishedEvent>[1][] = [];
  let delivery: PersistedDeliveryRecord;

  options.database.exec("BEGIN");

  try {
    for (const [index, draft] of options.drafts.entries()) {
      const envelope = buildFollowUpEventEnvelope({
        draft,
        sourceEvent: options.sourceEvent,
        producer: options.producer,
        sequence: index + 1,
        defaultArtifactRefs: options.defaultArtifactRefs
      });

      const publication = persistPublishedEvent(
        {
          database: options.database,
          manifest: options.manifest,
          runStore: options.runStore,
          eventStore: options.eventStore,
          deliveryStore: options.deliveryStore,
          envelope
        },
        { skipTransaction: true }
      );

      emittedEvents.push(publication.event);
      dispatchQueue.push(publication);
    }

    delivery = options.deliveryStore.acknowledgeDelivery(
      {
        deliveryId: options.deliveryId,
        leaseToken: options.leaseToken
      },
      { skipTransaction: true }
    );

    options.database.exec("COMMIT");

  } catch (error) {
    options.database.exec("ROLLBACK");
    throw error;
  }

  for (const publication of dispatchQueue) {
    dispatchPublishedEvent(options.dispatcher, publication);
  }

  return buildWorkerExecutionResult("success", delivery, resultPaths, emittedEvents);
}

export function createAdapterWorker(options: AdapterWorkerOptions) {
  const defaultRetryDelayMs = options.defaultRetryDelayMs ?? 30_000;
  const inFlightPids = new Set<number>();
  const inFlightDeliveryIds = new Set<string>();
  let sigKillHandle: ReturnType<typeof setTimeout> | undefined;

  return {
    // Sends SIGTERM then SIGKILL (after 5s) to all in-flight child process
    // groups. Uses negative PID (-pid) which targets the process group.
    // This depends on process-runner.ts spawning children with detached: true
    // so each child is a process group leader.
    forceKillInFlight(): void {
      for (const pid of inFlightPids) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // Process may have already exited.
        }
      }

      if (sigKillHandle !== undefined) {
        return;
      }

      sigKillHandle = setTimeout(() => {
        sigKillHandle = undefined;

        for (const pid of inFlightPids) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // Process may have already exited.
          }
        }
      }, 5_000);
      sigKillHandle.unref?.();
    },

    getInFlightDeliveryCount(): number {
      return inFlightDeliveryIds.size;
    },

    async runIteration(
      input: RunWorkerIterationInput
    ): Promise<AdapterWorkerExecutionResult | null> {
      let claimedDelivery: PersistedDeliveryRecord | null;

      try {
        claimedDelivery = options.deliveryService.claim({
          workerId: input.workerId,
          leaseDurationMs: input.leaseDurationMs,
          ...(input.asOf ? { asOf: input.asOf } : {})
        });
      } catch (error) {
        const conflictedDeliveryId = extractLeaseConflictDeliveryId(error);

        if (conflictedDeliveryId) {
          options.logger?.warn(
            {
              event: "lease.conflict",
              deliveryId: conflictedDeliveryId,
              workerId: input.workerId
            },
            "Lease conflict detected for delivery"
          );
          return null;
        }

        throw error;
      }

      if (!claimedDelivery) {
        return null;
      }

      inFlightDeliveryIds.add(claimedDelivery.deliveryId);

      const runPaths = buildRunDirectory(options.layout, claimedDelivery);
      const resultPaths: WorkerResultPaths = {
        workPackagePath: path.join(runPaths.runDirectory, "work-package.json"),
        resultFilePath: runPaths.resultFilePath,
        logFilePath: runPaths.logFilePath
      };
      const leaseToken = claimedDelivery.leaseToken;
      let deliveryLogger: DaemonLogger | undefined;

      if (!leaseToken) {
        throw new Error(
          `Claimed delivery ${claimedDelivery.deliveryId} is missing a lease token.`
        );
      }

      try {
        const event = options.eventStore.getEvent(claimedDelivery.eventId);

        if (!event) {
          throw new Error(`Persisted event not found for delivery ${claimedDelivery.deliveryId}.`);
        }

        deliveryLogger = options.logger?.child({
          deliveryId: claimedDelivery.deliveryId,
          agentId: claimedDelivery.agentId,
          runId: event.runId,
          workerId: input.workerId
        });
        deliveryLogger?.info({ event: "delivery.claimed" });

        const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);
        const verboseMonitor = options.verboseMonitorFactory?.(claimedDelivery.agentId);
        const monitorBase = mergeProcessMonitors(options.monitor, verboseMonitor);
        const perDeliveryMonitor: ProcessMonitorCallbacks | undefined =
          agent.timeout !== undefined
            ? {
                ...(monitorBase ?? {}),
                timeoutMs: agent.timeout * 1000
              }
            : monitorBase;
        const trackingMonitor: ProcessMonitorCallbacks = {
          ...(perDeliveryMonitor ?? {}),
          onStart: (info) => {
            inFlightPids.add(info.pid);
            perDeliveryMonitor?.onStart?.(info);
          },
          onComplete: (info) => {
            inFlightPids.delete(info.pid);
            perDeliveryMonitor?.onComplete?.(info);
          }
        };

        const requiredArtifacts = getRequiredArtifacts(
          options.manifest,
          event,
          claimedDelivery.agentId
        );

        assertRequiredArtifactsPresent(event, requiredArtifacts);

        const workPackage = createAdapterWorkPackage({
          agent: {
            id: agent.id,
            runtime: agent.runtime,
            ...(agent.description ? { description: agent.description } : {})
          },
          delivery: claimedDelivery,
          event,
          requiredArtifacts,
          layout: options.layout,
          resultFilePath: runPaths.resultFilePath,
          logFilePath: runPaths.logFilePath,
          ...(agent.workingDirectory
            ? { workingDirectory: agent.workingDirectory }
            : {})
        });

        const materializedRun = await materializeAdapterRun({
          runDirectory: runPaths.runDirectory,
          logFilePath: runPaths.logFilePath,
          resultFilePath: runPaths.resultFilePath,
          workPackage
        });

        deliveryLogger?.info({ event: "agent.started" });

        const processResult = await runPreparedAdapterCommand({
          materializedRun,
          execution: buildAdapterCommand({
            agent,
            workingDirectory: workPackage.workspace.workingDirectory,
            workPackagePath: materializedRun.workPackagePath,
            resultFilePath: materializedRun.resultFilePath,
            logFilePath: materializedRun.logFilePath,
            ...(options.mcpUrl ? { mcpUrl: options.mcpUrl } : {})
          }),
          monitor: trackingMonitor
        });

        if (!processResult.result) {
          const errorMessage =
            processResult.exitCode === 0 && processResult.signal === null
              ? `Adapter command for ${agent.id} exited without writing a result envelope.`
              : `Adapter command for ${agent.id} exited with code ${processResult.exitCode ?? "null"}${processResult.signal ? ` signal ${processResult.signal}` : ""}.`;
          const shouldDeadLetter =
            processResult.exitCode === 0 && processResult.signal === null;

          const result = finalizeLeaseBoundTransition({
            deliveryStore: options.deliveryStore,
            deliveryId: claimedDelivery.deliveryId,
            leaseToken,
            resultPaths: {
              workPackagePath: processResult.workPackagePath,
              resultFilePath: processResult.resultFilePath,
              logFilePath: processResult.logFilePath
            },
            transitionStatus: "process_error",
            transition: () =>
              shouldDeadLetter
                ? options.deliveryService.deadLetter({
                    deliveryId: claimedDelivery.deliveryId,
                    leaseToken,
                    errorMessage
                  })
                : options.deliveryService.fail({
                    deliveryId: claimedDelivery.deliveryId,
                    leaseToken,
                    errorMessage,
                    retryDelayMs: input.retryDelayMs ?? defaultRetryDelayMs
                  })
          });

          if (result.delivery.status === "dead_letter") {
            deliveryLogger?.error({
              event: "delivery.dead_lettered",
              errorMessage
            });
          } else if (result.delivery.status === "retry_scheduled") {
            deliveryLogger?.info({
              event: "delivery.retry_scheduled",
              errorMessage
            });
          }

          return result;
        }

        const adapterResult = processResult.result;

        if (adapterResult.status === "retryable_error") {
          const result = finalizeLeaseBoundTransition({
            deliveryStore: options.deliveryStore,
            deliveryId: claimedDelivery.deliveryId,
            leaseToken,
            resultPaths: {
              workPackagePath: processResult.workPackagePath,
              resultFilePath: processResult.resultFilePath,
              logFilePath: processResult.logFilePath
            },
            transitionStatus: adapterResult.status,
            transition: () =>
              options.deliveryService.fail({
                deliveryId: claimedDelivery.deliveryId,
                leaseToken,
                errorMessage: adapterResult.errorMessage,
                retryDelayMs: adapterResult.retryDelayMs
              })
          });

          if (result.delivery.status === "retry_scheduled") {
            deliveryLogger?.info({
              event: "delivery.retry_scheduled",
              errorMessage: adapterResult.errorMessage
            });
          }

          return result;
        }

        if (adapterResult.status === "fatal_error") {
          const result = finalizeLeaseBoundTransition({
            deliveryStore: options.deliveryStore,
            deliveryId: claimedDelivery.deliveryId,
            leaseToken,
            resultPaths: {
              workPackagePath: processResult.workPackagePath,
              resultFilePath: processResult.resultFilePath,
              logFilePath: processResult.logFilePath
            },
            transitionStatus: adapterResult.status,
            transition: () =>
              options.deliveryService.deadLetter({
                deliveryId: claimedDelivery.deliveryId,
                leaseToken,
                errorMessage: adapterResult.errorMessage
              })
          });

          if (result.delivery.status === "dead_letter") {
            deliveryLogger?.error({
              event: "delivery.dead_lettered",
              errorMessage: adapterResult.errorMessage
            });
          }

          return result;
        }

        const result = publishEmittedEventsAndAcknowledge(
          {
            database: options.database,
            manifest: options.manifest,
            runStore: options.runStore,
            eventStore: options.eventStore,
            deliveryStore: options.deliveryStore,
            dispatcher: options.dispatcher,
            deliveryId: claimedDelivery.deliveryId,
            leaseToken,
            drafts: adapterResult.events,
            sourceEvent: event,
            producer: {
              agentId: agent.id,
              runtime: agent.runtime
            },
            defaultArtifactRefs: adapterResult.outputArtifacts
          },
          {
            workPackagePath: processResult.workPackagePath,
            resultFilePath: processResult.resultFilePath,
            logFilePath: processResult.logFilePath
          }
        );

        deliveryLogger?.info({ event: "delivery.completed" });

        return result;
      } catch (error) {
        const staleLeaseDelivery = currentDeliveryLostLease(
          options.deliveryStore,
          claimedDelivery.deliveryId,
          leaseToken
        );

        if (staleLeaseDelivery) {
          return buildWorkerExecutionResult(
            "process_error",
            staleLeaseDelivery,
            resultPaths
          );
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown adapter worker failure.";
        const shouldDeadLetter = isFatalSetupError(error);

        const result = finalizeLeaseBoundTransition({
          deliveryStore: options.deliveryStore,
          deliveryId: claimedDelivery.deliveryId,
          leaseToken,
          resultPaths,
          transitionStatus: "process_error",
          transition: () =>
            shouldDeadLetter
              ? options.deliveryService.deadLetter({
                  deliveryId: claimedDelivery.deliveryId,
                  leaseToken,
                  errorMessage
                })
              : options.deliveryService.fail({
                  deliveryId: claimedDelivery.deliveryId,
                  leaseToken,
                  errorMessage,
                  retryDelayMs: input.retryDelayMs ?? defaultRetryDelayMs
                })
        });

        if (result.delivery.status === "dead_letter") {
          deliveryLogger?.error({
            event: "delivery.dead_lettered",
            errorMessage
          });
        } else if (result.delivery.status === "retry_scheduled") {
          deliveryLogger?.info({
            event: "delivery.retry_scheduled",
            errorMessage
          });
        }

        return result;
      } finally {
        inFlightDeliveryIds.delete(claimedDelivery.deliveryId);
      }
    }
  };
}
