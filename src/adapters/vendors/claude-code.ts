import type { PreparedAdapterCommand } from "../process-runner.js";

export interface VendorAdapterCommandInput {
  readonly executable: string;
  readonly existingArgs: readonly string[];
  readonly workingDirectory: string;
  readonly workPackagePath: string;
  readonly resultFilePath: string;
  readonly logFilePath: string;
  readonly baseEnvironment: Readonly<Record<string, string>>;
  readonly identityFilePath?: string;
}

function stripPromptArgs(existingArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];

  for (let index = 0; index < existingArgs.length; index += 1) {
    const arg = existingArgs[index];

    if (!arg) {
      continue;
    }

    if (arg === "-p" || arg === "--print") {
      index += 1;
      continue;
    }

    if (arg.startsWith("--print=")) {
      continue;
    }

    normalizedArgs.push(arg);
  }

  return normalizedArgs;
}

function buildClaudeCodePrompt(input: VendorAdapterCommandInput): string {
  const parts = [
    "You are running as a Claude Code worker inside Agent Bus.",
    `Read the work package JSON at "${input.workPackagePath}".`,
    `Use "${input.workingDirectory}" as the repository working directory.`,
    "The work package is the source of truth for artifact inputs, follow-up events, and output expectations."
  ];

  if (input.identityFilePath) {
    parts.push(`Your role and task instructions are defined in: ${input.identityFilePath}`);
  }

  parts.push(
    `Write the final Agent Bus result envelope JSON to "${input.resultFilePath}".`,
    "Do not print the result envelope to stdout."
  );

  return parts.join(" ");
}

export function buildClaudeCodeCommand(
  input: VendorAdapterCommandInput
): PreparedAdapterCommand {
  if (input.executable !== "claude") {
    throw new Error("Claude Code adapter requires the `claude` executable.");
  }

  const args = stripPromptArgs(input.existingArgs);

  args.push("-p", buildClaudeCodePrompt(input));

  return {
    command: input.executable,
    args,
    workingDirectory: input.workingDirectory,
    environment: input.baseEnvironment
  };
}
