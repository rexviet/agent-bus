import { z } from "zod";

import type { AgentBusManifest } from "../config/manifest-schema.js";
import type { PreparedAdapterCommand } from "./process-runner.js";
import { buildCodexCommand } from "./vendors/codex.js";
import { buildOpenCodeCommand } from "./vendors/open-code.js";

export const SupportedRuntimeFamilySchema = z.enum([
  "codex",
  "open-code",
  "antigravity"
]);

export type SupportedRuntimeFamily = z.infer<typeof SupportedRuntimeFamilySchema>;

export interface RuntimeDefinition {
  readonly family: SupportedRuntimeFamily;
  readonly displayName: string;
  readonly executableCandidates: readonly string[];
  readonly executionMode: "non_interactive_cli" | "editor_cli";
}

export interface BuildAdapterCommandInput {
  readonly agent: AgentBusManifest["agents"][number];
  readonly workingDirectory: string;
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
}

const runtimeDefinitions = {
  codex: {
    family: "codex",
    displayName: "Codex",
    executableCandidates: ["codex"],
    executionMode: "non_interactive_cli"
  },
  "open-code": {
    family: "open-code",
    displayName: "Open Code",
    executableCandidates: ["opencode", "open-code"],
    executionMode: "non_interactive_cli"
  },
  antigravity: {
    family: "antigravity",
    displayName: "Antigravity",
    executableCandidates: ["antigravity"],
    executionMode: "editor_cli"
  }
} as const satisfies Record<SupportedRuntimeFamily, RuntimeDefinition>;

export function listSupportedRuntimeDefinitions(): RuntimeDefinition[] {
  return Object.values(runtimeDefinitions);
}

export function isSupportedRuntimeFamily(
  runtime: string
): runtime is SupportedRuntimeFamily {
  return runtime in runtimeDefinitions;
}

export function getRuntimeDefinition(
  runtime: string
): RuntimeDefinition | null {
  return isSupportedRuntimeFamily(runtime) ? runtimeDefinitions[runtime] : null;
}

export function assertSupportedRuntimeFamily(
  runtime: string
): RuntimeDefinition {
  const definition = getRuntimeDefinition(runtime);

  if (definition) {
    return definition;
  }

  const supportedRuntimes = listSupportedRuntimeDefinitions()
    .map((item) => item.family)
    .join(", ");

  throw new Error(
    `Unsupported runtime family: ${runtime}. Supported runtimes: ${supportedRuntimes}.`
  );
}

export function guessRuntimeFamilyFromExecutable(
  executable: string
): SupportedRuntimeFamily | null {
  const normalizedExecutable = executable.trim();

  for (const definition of listSupportedRuntimeDefinitions()) {
    if (definition.executableCandidates.includes(normalizedExecutable)) {
      return definition.family;
    }
  }

  return null;
}

function buildBaseEnvironment(
  input: BuildAdapterCommandInput
): Record<string, string> {
  return {
    ...input.agent.environment,
    AGENT_BUS_SCHEMA_VERSION: "1",
    AGENT_BUS_AGENT_ID: input.agent.id,
    AGENT_BUS_RUNTIME: input.agent.runtime,
    AGENT_BUS_WORK_PACKAGE_PATH: input.workPackagePath,
    AGENT_BUS_RESULT_FILE_PATH: input.resultFilePath,
    AGENT_BUS_LOG_FILE_PATH: input.logFilePath
  };
}

function buildGenericManifestCommand(
  input: BuildAdapterCommandInput
): PreparedAdapterCommand {
  const [command, ...args] = input.agent.command;

  if (!command) {
    throw new Error(`Agent ${input.agent.id} does not define an executable command.`);
  }

  return {
    command,
    args,
    workingDirectory: input.workingDirectory,
    environment: buildBaseEnvironment(input)
  };
}

export function buildAdapterCommand(
  input: BuildAdapterCommandInput
): PreparedAdapterCommand {
  const runtimeDefinition = getRuntimeDefinition(input.agent.runtime);
  const executable = input.agent.command[0];

  if (!runtimeDefinition || !executable) {
    return buildGenericManifestCommand(input);
  }

  if (!runtimeDefinition.executableCandidates.includes(executable)) {
    return buildGenericManifestCommand(input);
  }

  const vendorInput = {
    executable,
    existingArgs: input.agent.command.slice(1),
    workingDirectory: input.workingDirectory,
    workPackagePath: input.workPackagePath,
    resultFilePath: input.resultFilePath,
    logFilePath: input.logFilePath,
    baseEnvironment: buildBaseEnvironment(input)
  };

  switch (runtimeDefinition.family) {
    case "codex":
      return buildCodexCommand(vendorInput);
    case "open-code":
      return buildOpenCodeCommand(vendorInput);
    case "antigravity":
      return buildGenericManifestCommand(input);
  }
}
