import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  AgentBusManifestSchema,
  type AgentBusManifest
} from "./manifest-schema.js";

export class ManifestValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "manifest";

    return `${pathLabel}: ${issue.message}`;
  });
}

function validateManifestRelationships(manifest: AgentBusManifest): string[] {
  const issues: string[] = [];
  const knownAgents = new Set<string>();
  const approvalTopics = new Set<string>();

  for (const agent of manifest.agents) {
    if (knownAgents.has(agent.id)) {
      issues.push(`agents.${agent.id}: duplicate agent ID.`);
    }

    knownAgents.add(agent.id);
  }

  for (const subscription of manifest.subscriptions) {
    if (!knownAgents.has(subscription.agentId)) {
      issues.push(
        `subscriptions.${subscription.agentId}:${subscription.topic}: references unknown agent ID.`
      );
    }
  }

  for (const gate of manifest.approvalGates) {
    if (approvalTopics.has(gate.topic)) {
      issues.push(`approvalGates.${gate.topic}: duplicate approval gate topic.`);
    }

    approvalTopics.add(gate.topic);
  }

  return issues;
}

export function parseManifestText(
  sourceText: string,
  sourceLabel = "manifest"
): AgentBusManifest {
  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(sourceText);
  } catch (error) {
    throw new ManifestValidationError(`Failed to parse YAML for ${sourceLabel}.`, [
      error instanceof Error ? error.message : "Unknown YAML parse error."
    ]);
  }

  const manifestResult = AgentBusManifestSchema.safeParse(parsedYaml);

  if (!manifestResult.success) {
    throw new ManifestValidationError(
      `Manifest validation failed for ${sourceLabel}.`,
      formatZodIssues(manifestResult.error)
    );
  }

  const relationshipIssues = validateManifestRelationships(manifestResult.data);

  if (relationshipIssues.length > 0) {
    throw new ManifestValidationError(
      `Manifest validation failed for ${sourceLabel}.`,
      relationshipIssues
    );
  }

  return manifestResult.data;
}

export async function loadManifest(manifestPath: string): Promise<AgentBusManifest> {
  const manifestText = await readFile(manifestPath, "utf8");

  return parseManifestText(manifestText, path.basename(manifestPath));
}
