import { z } from "zod";

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
