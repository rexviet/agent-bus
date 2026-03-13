import * as path from "node:path";

import type { DatabaseSync } from "node:sqlite";

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
  readonly defaultRetryDelayMs?: number;
  readonly monitor?: ProcessMonitorCallbacks;
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

  return {
    async runIteration(
      input: RunWorkerIterationInput
    ): Promise<AdapterWorkerExecutionResult | null> {
      const claimedDelivery = options.deliveryService.claim({
        workerId: input.workerId,
        leaseDurationMs: input.leaseDurationMs,
        ...(input.asOf ? { asOf: input.asOf } : {})
      });

      if (!claimedDelivery) {
        return null;
      }

      const runPaths = buildRunDirectory(options.layout, claimedDelivery);
      const resultPaths: WorkerResultPaths = {
        workPackagePath: path.join(runPaths.runDirectory, "work-package.json"),
        resultFilePath: runPaths.resultFilePath,
        logFilePath: runPaths.logFilePath
      };
      const leaseToken = claimedDelivery.leaseToken;

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

        const agent = getManifestAgent(options.manifest, claimedDelivery.agentId);
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

        const processResult = await runPreparedAdapterCommand({
          materializedRun,
          execution: buildAdapterCommand({
            agent,
            workingDirectory: workPackage.workspace.workingDirectory,
            workPackagePath: materializedRun.workPackagePath,
            resultFilePath: materializedRun.resultFilePath,
            logFilePath: materializedRun.logFilePath
          }),
          ...(options.monitor ? { monitor: options.monitor } : {})
        });

        if (!processResult.result) {
          const errorMessage =
            processResult.exitCode === 0 && processResult.signal === null
              ? `Adapter command for ${agent.id} exited without writing a result envelope.`
              : `Adapter command for ${agent.id} exited with code ${processResult.exitCode ?? "null"}${processResult.signal ? ` signal ${processResult.signal}` : ""}.`;

          return finalizeLeaseBoundTransition({
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
              processResult.exitCode === 0 && processResult.signal === null
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
        }

        const adapterResult = processResult.result;

        if (adapterResult.status === "retryable_error") {
          return finalizeLeaseBoundTransition({
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
        }

        if (adapterResult.status === "fatal_error") {
          return finalizeLeaseBoundTransition({
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
        }

        return publishEmittedEventsAndAcknowledge(
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

        return finalizeLeaseBoundTransition({
          deliveryStore: options.deliveryStore,
          deliveryId: claimedDelivery.deliveryId,
          leaseToken,
          resultPaths,
          transitionStatus: "process_error",
          transition: () =>
            isFatalSetupError(error)
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
      }
    }
  };
}
