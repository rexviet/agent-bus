import type { PreparedAdapterCommand } from "../process-runner.js";

export interface VendorAdapterCommandInput {
  readonly executable: string;
  readonly existingArgs: readonly string[];
  readonly workingDirectory: string;
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly baseEnvironment: Readonly<Record<string, string>>;
}

function buildOpenCodePrompt(input: VendorAdapterCommandInput): string {
  return [
    "You are running as an Open Code worker inside Agent Bus.",
    `Read the attached work package JSON at "${input.workPackagePath}".`,
    `Use "${input.workingDirectory}" as the repository working directory.`,
    `Write the final Agent Bus result envelope JSON to "${input.resultFilePath}".`,
    "Do not print the result envelope to stdout."
  ].join(" ");
}

export function buildOpenCodeCommand(
  input: VendorAdapterCommandInput
): PreparedAdapterCommand {
  if (!["opencode", "open-code"].includes(input.executable)) {
    throw new Error("Open Code adapter requires the `opencode` executable.");
  }

  const existingArgs =
    input.existingArgs[0] === "run"
      ? input.existingArgs.slice(1)
      : [...input.existingArgs];

  const args = [
    "run",
    "--dir",
    input.workingDirectory,
    "--file",
    input.workPackagePath,
    "--format",
    "json",
    ...existingArgs,
    buildOpenCodePrompt(input)
  ];

  return {
    command: input.executable,
    args,
    workingDirectory: input.workingDirectory,
    environment: input.baseEnvironment
  };
}
