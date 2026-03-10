import * as path from "node:path";

import type { AgentBusDaemon } from "../daemon/index.js";
import { startDaemon } from "../daemon/index.js";
import {
  writeFailureDeliveriesText,
  writeJson,
  writePendingApprovalsText,
  writeRunDetailText,
  writeRunSummariesText,
  type WritableTextStream
} from "./output.js";

export interface OperatorCommandIO {
  readonly cwd: string;
  readonly stdout: WritableTextStream;
  readonly stderr: WritableTextStream;
}

const OPERATOR_HELP_TEXT = `Operator commands:
  agent-bus runs list [--config path] [--limit N] [--json]
  agent-bus runs show <run-id> [--config path] [--json]
  agent-bus approvals list [--config path] [--json]
  agent-bus failures list [--config path] [--json]
`;

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function readOptionValue(
  args: readonly string[],
  optionName: string
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

function writeError(stream: WritableTextStream, message: string): void {
  stream.write(`${message}\n`);
}

function parsePositiveInteger(value: string | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

async function withDaemon<T>(
  args: readonly string[],
  io: OperatorCommandIO,
  callback: (daemon: AgentBusDaemon) => Promise<T> | T
): Promise<T> {
  const configPath = readOptionValue(args, "--config") ?? "agent-bus.yaml";
  const absoluteConfigPath = path.resolve(io.cwd, configPath);
  const daemon = await startDaemon({
    configPath: absoluteConfigPath,
    registerSignalHandlers: false
  });

  try {
    return await callback(daemon);
  } finally {
    await daemon.stop();
  }
}

async function runRunsCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const [subcommand] = args;
  const json = hasFlag(args, "--json");

  if (subcommand === "list") {
    let limit: number | undefined;

    try {
      limit = parsePositiveInteger(readOptionValue(args, "--limit"), "--limit") ?? undefined;
    } catch (error) {
      writeError(io.stderr, error instanceof Error ? error.message : "Invalid limit.");
      return 1;
    }

    return withDaemon(args, io, async (daemon) => {
      const summaries = daemon.listRunSummaries(limit);

      if (json) {
        writeJson(io.stdout, summaries);
      } else {
        writeRunSummariesText(io.stdout, summaries);
      }

      return 0;
    });
  }

  if (subcommand === "show") {
    const runId = args[1];

    if (!runId || runId.startsWith("--")) {
      writeError(io.stderr, "runs show requires a <run-id>.");
      return 1;
    }

    return withDaemon(args, io, async (daemon) => {
      const detail = daemon.getRunDetail(runId);

      if (!detail) {
        writeError(io.stderr, `Run not found: ${runId}`);
        return 1;
      }

      if (json) {
        writeJson(io.stdout, detail);
      } else {
        writeRunDetailText(io.stdout, detail);
      }

      return 0;
    });
  }

  writeError(io.stderr, `Unknown runs subcommand: ${subcommand ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`);
  return 1;
}

async function runApprovalsCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const [subcommand] = args;
  const json = hasFlag(args, "--json");

  if (subcommand !== "list") {
    writeError(
      io.stderr,
      `Unknown approvals subcommand: ${subcommand ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`
    );
    return 1;
  }

  return withDaemon(args, io, async (daemon) => {
    const approvals = daemon.listPendingApprovalViews();

    if (json) {
      writeJson(io.stdout, approvals);
    } else {
      writePendingApprovalsText(io.stdout, approvals);
    }

    return 0;
  });
}

async function runFailuresCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const [subcommand] = args;
  const json = hasFlag(args, "--json");

  if (subcommand !== "list") {
    writeError(
      io.stderr,
      `Unknown failures subcommand: ${subcommand ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`
    );
    return 1;
  }

  return withDaemon(args, io, async (daemon) => {
    const failures = daemon.listFailureDeliveries();

    if (json) {
      writeJson(io.stdout, failures);
    } else {
      writeFailureDeliveriesText(io.stdout, failures);
    }

    return 0;
  });
}

export async function runOperatorCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const [command, ...rest] = args;

  switch (command) {
    case "runs":
      return runRunsCommand(rest, io);
    case "approvals":
      return runApprovalsCommand(rest, io);
    case "failures":
      return runFailuresCommand(rest, io);
    default:
      writeError(
        io.stderr,
        `Unknown operator command: ${command ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`
      );
      return 1;
  }
}
