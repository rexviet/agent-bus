import * as path from "node:path";

import {
  createRuntimeLayout,
  ensureRuntimeLayout,
  formatRuntimeLayout
} from "./shared/runtime-layout.js";
import { loadManifest, ManifestValidationError } from "./config/load-manifest.js";
import { runOperatorCommand } from "./cli/operator-command.js";
import { runWorkerCommand } from "./cli/worker-command.js";
import type { WritableTextStream } from "./cli/output.js";

const HELP_TEXT = `agent-bus

Usage:
  agent-bus --help
  agent-bus daemon [--config path] [--exit-after-ready]
  agent-bus worker [--config path] [--worker-id id] [--lease-duration-ms N] [--poll-interval-ms N] [--retry-delay-ms N] [--log-level level] [--once]
  agent-bus layout [--config path] [--ensure]
  agent-bus validate-manifest [path]
  agent-bus runs <subcommand>
  agent-bus approvals <subcommand>
  agent-bus failures <subcommand>
  agent-bus replay <target>
  agent-bus publish --envelope <file>

Commands:
  daemon         Start the local dispatcher process
  worker         Run a local worker loop that claims and executes deliveries
  layout          Print resolved runtime directories
  validate-manifest
                 Validate a workflow manifest file
  runs           Inspect recent runs and run details
  approvals      List pending approval work
  failures       Inspect retry-scheduled and dead-letter deliveries
  replay         Replay an event or delivery
  publish        Publish an event envelope from disk

Options:
  --config        Manifest path to load
  --ensure        Create missing runtime directories before printing them
  --exit-after-ready
                 Start the daemon, initialize everything, then exit cleanly
  --help          Show this help output
`;

export interface CliMainOptions {
  readonly cwd?: string;
  readonly stdout?: WritableTextStream;
  readonly stderr?: WritableTextStream;
}

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

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  options: CliMainOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();

  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const [command] = argv;

  if (command === "layout") {
    const configPath = readOptionValue(argv, "--config") ?? "agent-bus.yaml";
    const absoluteConfigPath = path.resolve(cwd, configPath);
    const manifest = await loadManifest(absoluteConfigPath);
    const repositoryRoot = path.resolve(cwd);
    const layout = hasFlag(argv, "--ensure")
      ? await ensureRuntimeLayout({
          repositoryRoot,
          workspace: manifest.workspace
        })
      : createRuntimeLayout({
          repositoryRoot,
          workspace: manifest.workspace
        });

    stdout.write(`${formatRuntimeLayout(layout)}\n`);
    return 0;
  }

  if (command === "validate-manifest") {
    const manifestPath = argv[1] ?? "agent-bus.yaml";

    try {
      const manifest = await loadManifest(path.resolve(cwd, manifestPath));
      stdout.write(
        `Manifest is valid: ${manifestPath}\n` +
          `agents=${manifest.agents.length} subscriptions=${manifest.subscriptions.length} approvalGates=${manifest.approvalGates.length}\n`
      );
      return 0;
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        stderr.write(`${error.message}\n`);

        for (const issue of error.issues) {
          stderr.write(`- ${issue}\n`);
        }

        return 1;
      }

      throw error;
    }
  }

  if (command === "daemon") {
    const { startDaemon } = await import("./daemon/index.js");
    const configPath = readOptionValue(argv, "--config") ?? "agent-bus.yaml";
    const exitAfterReady = hasFlag(argv, "--exit-after-ready");
    const daemon = await startDaemon({
      configPath: path.resolve(cwd, configPath),
      repositoryRoot: path.resolve(cwd)
    });

    stdout.write(
      `Daemon ready\nconfigPath: ${configPath}\ndatabasePath: ${daemon.databasePath}\n`
    );

    if (exitAfterReady) {
      await daemon.stop();
      stdout.write("Daemon exited after readiness check\n");
      return 0;
    }

    return 0;
  }

  if (command === "worker") {
    return runWorkerCommand(argv.slice(1), {
      cwd,
      stdout,
      stderr
    });
  }

  if (command && ["runs", "approvals", "failures", "replay", "publish"].includes(command)) {
    return runOperatorCommand(argv, {
      cwd,
      stdout,
      stderr
    });
  }

  stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}\n`);
  return 1;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const exitCode = await main();

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
