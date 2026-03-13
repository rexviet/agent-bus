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

function hasArgument(
  args: readonly string[],
  optionName: string
): boolean {
  return args.includes(optionName) || args.some((arg) => arg.startsWith(`${optionName}=`));
}

function stripPromptArgs(existingArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];

  for (let index = 0; index < existingArgs.length; index += 1) {
    const arg = existingArgs[index];

    if (!arg) {
      continue;
    }

    if (arg === "-p" || arg === "--prompt") {
      index += 1;
      continue;
    }

    if (arg.startsWith("--prompt=")) {
      continue;
    }

    normalizedArgs.push(arg);
  }

  return normalizedArgs;
}

function toGeminiAttachmentPath(
  workingDirectory: string,
  targetPath: string
): string {
  const relativePath = path.relative(workingDirectory, targetPath).split(path.sep).join("/");
  const prefixedPath =
    relativePath.startsWith(".") || relativePath.startsWith("/")
      ? relativePath
      : `./${relativePath}`;

  return prefixedPath.replace(/ /g, "\\ ");
}

function buildGeminiPrompt(input: VendorAdapterCommandInput): string {
  const workPackageAttachmentPath = toGeminiAttachmentPath(
    input.workingDirectory,
    input.workPackagePath
  );

  return [
    "You are running as a Gemini CLI worker inside Agent Bus.",
    `Read the attached work package JSON first: @${workPackageAttachmentPath}`,
    `Use "${input.workingDirectory}" as the repository working directory.`,
    "The work package is the source of truth for artifact inputs, follow-up events, and output expectations.",
    `Write the final Agent Bus result envelope JSON to "${input.resultFilePath}".`,
    "Do not print the result envelope to stdout."
  ].join(" ");
}

export function buildGeminiCommand(
  input: VendorAdapterCommandInput
): PreparedAdapterCommand {
  if (input.executable !== "gemini") {
    throw new Error("Gemini adapter requires the `gemini` executable.");
  }

  const args = stripPromptArgs(input.existingArgs);

  if (!hasArgument(args, "--approval-mode")) {
    args.push("--approval-mode", "auto_edit");
  }

  args.push("-p", buildGeminiPrompt(input));

  return {
    command: input.executable,
    args,
    workingDirectory: input.workingDirectory,
    environment: input.baseEnvironment
  };
}
