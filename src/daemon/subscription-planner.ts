import type { AgentBusManifest } from "../config/manifest-schema.js";

export interface PlannedSubscriptionTarget {
  readonly agentId: string;
  readonly topic: string;
  readonly requiredArtifacts: AgentBusManifest["subscriptions"][number]["requiredArtifacts"];
  readonly description?: string;
}

export function planSubscriptionsForTopic(
  manifest: AgentBusManifest,
  topic: string
): PlannedSubscriptionTarget[] {
  const targets: PlannedSubscriptionTarget[] = [];
  const seenAgentIds = new Set<string>();

  for (const subscription of manifest.subscriptions) {
    if (subscription.topic !== topic || seenAgentIds.has(subscription.agentId)) {
      continue;
    }

    seenAgentIds.add(subscription.agentId);
    targets.push({
      agentId: subscription.agentId,
      topic: subscription.topic,
      requiredArtifacts: subscription.requiredArtifacts,
      ...(subscription.description ? { description: subscription.description } : {})
    });
  }

  return targets;
}
