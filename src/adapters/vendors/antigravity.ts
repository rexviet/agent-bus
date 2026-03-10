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

function buildAntigravityPrompt(input: VendorAdapterCommandInput): string {
  return [
    "You are running as an Antigravity worker inside Agent Bus.",
    `Read the attached work package JSON at "${input.workPackagePath}".`,
    `Use "${input.workingDirectory}" as the repository working directory.`,
    `Write the final Agent Bus result envelope JSON to "${input.resultFilePath}".`,
    "Do not print the result envelope to stdout."
  ].join(" ");
}

export function buildAntigravityCommand(
  input: VendorAdapterCommandInput
): PreparedAdapterCommand {
  if (input.executable !== "antigravity") {
    throw new Error("Antigravity adapter requires the `antigravity` executable.");
  }

  const existingArgs =
    input.existingArgs[0] === "chat"
      ? input.existingArgs.slice(1)
      : [...input.existingArgs];
  const args = ["chat"];

  if (!existingArgs.includes("--mode") && !existingArgs.includes("-m")) {
    args.push("--mode", "agent");
  }

  args.push("--add-file", input.workPackagePath, ...existingArgs, buildAntigravityPrompt(input));

  return {
    command: input.executable,
    args,
    workingDirectory: input.workingDirectory,
    environment: input.baseEnvironment
  };
}
