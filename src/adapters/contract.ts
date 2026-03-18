import * as path from "node:path";

import { z } from "zod";

import {
  ArtifactRefSchema,
  normalizeArtifactRefPath,
  resolveArtifactRefPath
} from "../domain/artifact-ref.js";
import type { RuntimeLayout } from "../shared/runtime-layout.js";

const TopicSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9._-]+$/, "Topic must use lowercase letters, digits, dots, underscores, or hyphens.");

const ApprovalStatusSchema = z.enum([
  "not_required",
  "pending",
  "approved",
  "rejected"
]);

const DeliveryStatusSchema = z.enum([
  "pending_approval",
  "ready",
  "leased",
  "retry_scheduled",
  "completed",
  "dead_letter",
  "cancelled"
]);

const ProducerSchema = z.object({
  agentId: z.string().min(1),
  runtime: z.string().min(1),
  model: z.string().min(1).optional()
});

const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const AdapterArtifactInputSchema = ArtifactRefSchema.extend({
  absolutePath: z.string().min(1)
});

export const AdapterAgentSchema = z.object({
  id: z.string().min(1),
  runtime: z.string().min(1),
  description: z.string().min(1).optional()
});

export const AdapterDeliveryContextSchema = z.object({
  deliveryId: z.string().min(1),
  eventId: z.uuid(),
  agentId: z.string().min(1),
  topic: TopicSchema,
  status: DeliveryStatusSchema,
  availableAt: IsoDateTimeSchema,
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().min(1).optional(),
  leaseToken: z.string().min(1).optional(),
  leaseOwner: z.string().min(1).optional(),
  leaseExpiresAt: IsoDateTimeSchema.optional(),
  claimedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
  lastAttemptedAt: IsoDateTimeSchema.optional(),
  deadLetteredAt: IsoDateTimeSchema.optional(),
  deadLetterReason: z.string().min(1).optional(),
  replayCount: z.number().int().nonnegative(),
  replayedFromDeliveryId: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const AdapterEventContextSchema = z.object({
  eventId: z.uuid(),
  runId: z.string().min(1),
  topic: TopicSchema,
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  dedupeKey: z.string().min(1),
  approvalStatus: ApprovalStatusSchema,
  producer: ProducerSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadMetadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  artifactRefs: z.array(ArtifactRefSchema).default([])
});

export const AdapterWorkspaceSchema = z.object({
  repositoryRoot: z.string().min(1),
  workspaceDir: z.string().min(1),
  stateDir: z.string().min(1),
  logsDir: z.string().min(1),
  workingDirectory: z.string().min(1),
  resultFilePath: z.string().min(1),
  logFilePath: z.string().min(1)
});

export const EmittedEventDraftSchema = z.object({
  topic: TopicSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadMetadata: z.record(z.string(), z.unknown()).default({}),
  artifactRefs: z.array(ArtifactRefSchema).default([]),
  dedupeKey: z.string().min(1).optional()
});

export const SuccessfulAdapterResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("success"),
  summary: z.string().min(1).optional(),
  outputArtifacts: z.array(ArtifactRefSchema).default([]),
  events: z.array(EmittedEventDraftSchema).default([])
});

export const RetryableAdapterResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("retryable_error"),
    errorMessage: z.string().min(1),
    retryDelayMs: z.number().int().nonnegative().optional(),
    // Backward-compat alias used by some adapters/agents.
    retryAfterMs: z.number().int().nonnegative().optional(),
    summary: z.string().min(1).optional(),
    outputArtifacts: z.array(ArtifactRefSchema).default([]),
    events: z.array(EmittedEventDraftSchema).default([])
  })
  .superRefine((value, ctx) => {
    if (value.retryDelayMs === undefined && value.retryAfterMs === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retryDelayMs"],
        message:
          "retryDelayMs is required (retryAfterMs is accepted as a deprecated alias)."
      });
    }
  })
  .transform((value) => {
    const retryDelayMs = value.retryDelayMs ?? value.retryAfterMs!;
    const { retryAfterMs: _retryAfterMs, ...rest } = value;
    return {
      ...rest,
      retryDelayMs
    };
  });

export const FatalAdapterResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("fatal_error"),
  errorMessage: z.string().min(1),
  summary: z.string().min(1).optional(),
  outputArtifacts: z.array(ArtifactRefSchema).default([]),
  events: z.array(EmittedEventDraftSchema).default([])
});

export const AdapterResultEnvelopeSchema = z.discriminatedUnion("status", [
  SuccessfulAdapterResultSchema,
  RetryableAdapterResultSchema,
  FatalAdapterResultSchema
]);

export const AdapterWorkPackageSchema = z.object({
  schemaVersion: z.literal(1),
  agent: AdapterAgentSchema,
  delivery: AdapterDeliveryContextSchema,
  event: AdapterEventContextSchema,
  requiredArtifacts: z.array(ArtifactRefSchema).default([]),
  artifactInputs: z.array(AdapterArtifactInputSchema).default([]),
  workspace: AdapterWorkspaceSchema
});

export type AdapterArtifactInput = z.infer<typeof AdapterArtifactInputSchema>;
export type AdapterAgent = z.infer<typeof AdapterAgentSchema>;
export type AdapterDeliveryContext = z.infer<typeof AdapterDeliveryContextSchema>;
export type AdapterEventContext = z.infer<typeof AdapterEventContextSchema>;
export type AdapterWorkspace = z.infer<typeof AdapterWorkspaceSchema>;
export type EmittedEventDraft = z.infer<typeof EmittedEventDraftSchema>;
export type AdapterResultEnvelope = z.infer<typeof AdapterResultEnvelopeSchema>;
export type AdapterWorkPackage = z.infer<typeof AdapterWorkPackageSchema>;

export interface CreateAdapterWorkPackageInput {
  readonly agent: z.input<typeof AdapterAgentSchema>;
  readonly delivery: z.input<typeof AdapterDeliveryContextSchema>;
  readonly event: z.input<typeof AdapterEventContextSchema>;
  readonly layout: RuntimeLayout;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly workingDirectory?: string;
  readonly requiredArtifacts?: ReadonlyArray<z.input<typeof ArtifactRefSchema>>;
}

function assertPathInside(
  parentPath: string,
  targetPath: string,
  label: string
): string {
  const resolvedParentPath = path.resolve(parentPath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedParentPath, resolvedTargetPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside ${resolvedParentPath}: ${targetPath}`);
  }

  return resolvedTargetPath;
}

export function resolveAdapterWorkingDirectory(
  repositoryRoot: string,
  workingDirectory?: string
): string {
  if (!workingDirectory) {
    return path.resolve(repositoryRoot);
  }

  const normalizedWorkingDirectory = normalizeArtifactRefPath(workingDirectory);

  return assertPathInside(
    repositoryRoot,
    path.resolve(repositoryRoot, normalizedWorkingDirectory),
    "Adapter working directory"
  );
}

export function resolveAdapterArtifactInputs(
  layout: RuntimeLayout,
  artifactRefs: ReadonlyArray<z.input<typeof ArtifactRefSchema>>
): AdapterArtifactInput[] {
  return artifactRefs.map((artifactRef) => {
    const normalizedArtifactRef = ArtifactRefSchema.parse(artifactRef);

    return AdapterArtifactInputSchema.parse({
      ...normalizedArtifactRef,
      absolutePath: resolveArtifactRefPath(layout, normalizedArtifactRef.path)
    });
  });
}

export function createAdapterWorkPackage(
  input: CreateAdapterWorkPackageInput
): AdapterWorkPackage {
  const repositoryRoot = path.resolve(input.layout.repositoryRoot);
  const workspace = AdapterWorkspaceSchema.parse({
    repositoryRoot,
    workspaceDir: path.resolve(input.layout.workspaceDir),
    stateDir: path.resolve(input.layout.stateDir),
    logsDir: path.resolve(input.layout.logsDir),
    workingDirectory: resolveAdapterWorkingDirectory(
      repositoryRoot,
      input.workingDirectory
    ),
    resultFilePath: assertPathInside(
      input.layout.stateDir,
      input.resultFilePath,
      "Adapter result file"
    ),
    logFilePath: assertPathInside(
      input.layout.logsDir,
      input.logFilePath,
      "Adapter log file"
    )
  });

  return AdapterWorkPackageSchema.parse({
    schemaVersion: 1,
    agent: input.agent,
    delivery: input.delivery,
    event: input.event,
    requiredArtifacts: input.requiredArtifacts ?? [],
    artifactInputs: resolveAdapterArtifactInputs(
      input.layout,
      input.event.artifactRefs ?? []
    ),
    workspace
  });
}

export function parseAdapterWorkPackage(input: unknown): AdapterWorkPackage {
  return AdapterWorkPackageSchema.parse(input);
}

export function parseAdapterResultEnvelope(
  input: unknown
): AdapterResultEnvelope {
  return AdapterResultEnvelopeSchema.parse(input);
}
