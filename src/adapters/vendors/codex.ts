import * as path from "node:path";

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

function buildCodexPrompt(input: VendorAdapterCommandInput): string {
  return [
    "You are running as a Codex worker inside Agent Bus.",
    `Read the work package JSON at "${input.workPackagePath}".`,
    `Use "${input.workingDirectory}" as the repository working directory.`,
    `Write the final Agent Bus result envelope JSON to "${input.resultFilePath}".`,
    "Do not print the result envelope to stdout."
  ].join(" ");
}

export function buildCodexCommand(
  input: VendorAdapterCommandInput
): PreparedAdapterCommand {
  if (input.executable !== "codex") {
    throw new Error("Codex adapter requires the `codex` executable.");
  }

  const args =
    input.existingArgs[0] === "exec"
      ? [...input.existingArgs]
      : ["exec", ...input.existingArgs];

  if (!args.includes("--output-last-message") && !args.includes("-o")) {
    args.push(
      "--output-last-message",
      path.join(path.dirname(input.resultFilePath), "codex-last-message.txt")
    );
  }

  args.push(buildCodexPrompt(input));

  return {
    command: input.executable,
    args,
    workingDirectory: input.workingDirectory,
    environment: input.baseEnvironment
  };
}
