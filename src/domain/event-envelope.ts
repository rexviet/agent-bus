import { z } from "zod";

import { ArtifactRefSchema } from "./artifact-ref.js";

const TopicSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9._-]+$/, "Topic must use lowercase letters, digits, dots, underscores, or hyphens.");

const ProducerSchema = z.object({
  agentId: z.string().min(1),
  runtime: z.string().min(1),
  model: z.string().min(1).optional()
});

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

export function parseEventEnvelope(input: unknown): EventEnvelope {
  return EventEnvelopeSchema.parse(input);
}
