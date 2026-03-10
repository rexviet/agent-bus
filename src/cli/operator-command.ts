import * as path from "node:path";

import type { AgentBusDaemon } from "../daemon/index.js";
import { startDaemon } from "../daemon/index.js";
import { loadEventEnvelopeFromFile } from "./load-envelope.js";
import {
  writeApprovalDecisionText,
  writeFailureDeliveriesText,
  writeJson,
  writePendingApprovalsText,
  writePublishedEventText,
  writeReplayResultText,
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
  agent-bus approvals approve <approval-id> --by <actor> [--config path] [--json]
  agent-bus approvals reject <approval-id> --by <actor> --feedback <text> [--config path] [--json]
  agent-bus failures list [--config path] [--json]
  agent-bus replay delivery <delivery-id> [--config path] [--available-at <iso>] [--json]
  agent-bus replay event <event-id> [--config path] [--available-at <iso>] [--json]
  agent-bus publish --envelope <file> [--config path] [--json]
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

function readRequiredOptionValue(
  args: readonly string[],
  optionName: string,
  errorMessage: string
): string {
  const value = readOptionValue(args, optionName);

  if (!value || value.startsWith("--")) {
    throw new Error(errorMessage);
  }

  return value;
}

function normalizeOptionalIsoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }

  return value;
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
    repositoryRoot: io.cwd,
    startRecoveryScan: false,
    runRecoveryScanOnStart: false,
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

  if (subcommand === "list") {
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

  if (subcommand === "approve" || subcommand === "reject") {
    const approvalId = args[1];

    if (!approvalId || approvalId.startsWith("--")) {
      writeError(io.stderr, `approvals ${subcommand} requires an <approval-id>.`);
      return 1;
    }

    let decidedBy: string;
    let feedback: string | undefined;

    try {
      decidedBy = readRequiredOptionValue(
        args,
        "--by",
        `approvals ${subcommand} requires --by <actor>.`
      );
      feedback =
        subcommand === "reject"
          ? readRequiredOptionValue(
              args,
              "--feedback",
              "approvals reject requires --feedback <text>."
            )
          : undefined;
    } catch (error) {
      writeError(io.stderr, error instanceof Error ? error.message : "Invalid approval command.");
      return 1;
    }

    return withDaemon(args, io, async (daemon) => {
      try {
        const result =
          subcommand === "approve"
            ? daemon.approve(approvalId, decidedBy)
            : daemon.reject(approvalId, decidedBy, feedback);

        if (json) {
          writeJson(io.stdout, result);
        } else {
          writeApprovalDecisionText(io.stdout, result);
        }

        return 0;
      } catch (error) {
        writeError(io.stderr, error instanceof Error ? error.message : "Approval update failed.");
        return 1;
      }
    });
  }

  writeError(
    io.stderr,
    `Unknown approvals subcommand: ${subcommand ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`
  );
  return 1;
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

async function runReplayCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const [target, identifier] = args;
  const json = hasFlag(args, "--json");
  let availableAt: string | undefined;

  if (!target || !identifier || identifier.startsWith("--")) {
    writeError(io.stderr, "replay requires a target and identifier.");
    return 1;
  }

  try {
    availableAt = normalizeOptionalIsoTimestamp(readOptionValue(args, "--available-at"));
  } catch (error) {
    writeError(io.stderr, error instanceof Error ? error.message : "Invalid replay timestamp.");
    return 1;
  }

  return withDaemon(args, io, async (daemon) => {
    try {
      const result =
        target === "delivery"
          ? daemon.replayDelivery(identifier, availableAt)
          : target === "event"
            ? daemon.replayEvent(identifier, availableAt)
            : null;

      if (!result) {
        writeError(io.stderr, `Unknown replay target: ${target}\n\n${OPERATOR_HELP_TEXT}`);
        return 1;
      }

      if (json) {
        writeJson(io.stdout, result);
      } else {
        writeReplayResultText(io.stdout, result);
      }

      return 0;
    } catch (error) {
      writeError(io.stderr, error instanceof Error ? error.message : "Replay failed.");
      return 1;
    }
  });
}

async function runPublishCommand(
  args: readonly string[],
  io: OperatorCommandIO
): Promise<number> {
  const json = hasFlag(args, "--json");
  let envelopePath: string;

  try {
    envelopePath = readRequiredOptionValue(
      args,
      "--envelope",
      "publish requires --envelope <file>."
    );
  } catch (error) {
    writeError(io.stderr, error instanceof Error ? error.message : "Invalid publish command.");
    return 1;
  }

  return withDaemon(args, io, async (daemon) => {
    try {
      const envelope = await loadEventEnvelopeFromFile(envelopePath, io.cwd);
      const event = daemon.publish(envelope);

      if (json) {
        writeJson(io.stdout, event);
      } else {
        writePublishedEventText(io.stdout, event);
      }

      return 0;
    } catch (error) {
      writeError(io.stderr, error instanceof Error ? error.message : "Publish failed.");
      return 1;
    }
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
    case "replay":
      return runReplayCommand(rest, io);
    case "publish":
      return runPublishCommand(rest, io);
    default:
      writeError(
        io.stderr,
        `Unknown operator command: ${command ?? "(missing)"}\n\n${OPERATOR_HELP_TEXT}`
      );
      return 1;
  }
}
