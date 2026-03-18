import { z } from "zod";

import { ArtifactRefSchema, normalizeArtifactRefPath } from "../domain/artifact-ref.js";

const AgentIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/, "Agent IDs must start with a letter and contain only lowercase letters, digits, underscores, or hyphens.");

const TopicSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9._-]+$/, "Topic names must use lowercase letters, digits, dots, underscores, or hyphens.");

const RelativeDirectorySchema = z.string().min(1).transform((value, ctx) => {
  try {
    return normalizeArtifactRefPath(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid relative directory path."
    });

    return z.NEVER;
  }
});

const CommandSchema = z.array(z.string().min(1)).min(1);

const ArtifactConventionSchema = z.object({
  topic: TopicSchema,
  outputs: z.array(ArtifactRefSchema).min(1)
});

const SubscriptionSchema = z.object({
  agentId: AgentIdSchema,
  topic: TopicSchema,
  description: z.string().min(1).optional(),
  requiredArtifacts: z.array(ArtifactRefSchema).default([])
});

const ApprovalGateSchema = z.object({
  topic: TopicSchema,
  decision: z.literal("manual"),
  approvers: z.array(z.string().min(1)).min(1),
  onReject: z.enum(["return_to_producer", "cancel_run"])
});

const SchemaDeclarationSchema = z.object({
  enforcement: z.enum(["warn", "reject"]).default("warn"),
  schema: z.unknown()
});

const AgentSchema = z.object({
  id: AgentIdSchema,
  runtime: z.string().min(1),
  description: z.string().min(1).optional(),
  identityFile: z.string().min(1).optional(),
  command: CommandSchema,
  workingDirectory: RelativeDirectorySchema.optional(),
  timeout: z.number().positive().optional(),
  environment: z.record(z.string(), z.string()).default({})
});

export const AgentBusManifestSchema = z.object({
  version: z.literal(1),
  workspace: z.object({
    artifactsDir: RelativeDirectorySchema,
    stateDir: RelativeDirectorySchema,
    logsDir: RelativeDirectorySchema
  }),
  agents: z.array(AgentSchema).min(1),
  subscriptions: z.array(SubscriptionSchema).min(1),
  schemas: z.record(TopicSchema, SchemaDeclarationSchema).default({}),
  approvalGates: z.array(ApprovalGateSchema).default([]),
  artifactConventions: z.array(ArtifactConventionSchema).default([])
});

export type AgentBusManifest = z.infer<typeof AgentBusManifestSchema>;
