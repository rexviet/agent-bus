import * as path from "node:path";

import {
  createRuntimeLayout,
  ensureRuntimeLayout,
  formatRuntimeLayout
} from "./shared/runtime-layout.js";
import { loadManifest, ManifestValidationError } from "./config/load-manifest.js";

const HELP_TEXT = `agent-bus

Usage:
  agent-bus --help
  agent-bus layout
  agent-bus layout --ensure
  agent-bus validate-manifest [path]

Commands:
  layout          Print resolved runtime directories
  validate-manifest
                 Validate a workflow manifest file

Options:
  --ensure        Create missing runtime directories before printing them
  --help          Show this help output
`;

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  const [command] = argv;

  if (command === "layout") {
    const layout = hasFlag(argv, "--ensure")
      ? await ensureRuntimeLayout()
      : createRuntimeLayout();

    process.stdout.write(`${formatRuntimeLayout(layout)}\n`);
    return;
  }

  if (command === "validate-manifest") {
    const manifestPath = argv[1] ?? "agent-bus.yaml";

    try {
      const manifest = await loadManifest(path.resolve(process.cwd(), manifestPath));
      process.stdout.write(
        `Manifest is valid: ${manifestPath}\n` +
          `agents=${manifest.agents.length} subscriptions=${manifest.subscriptions.length} approvalGates=${manifest.approvalGates.length}\n`
      );
      return;
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        process.stderr.write(`${error.message}\n`);

        for (const issue of error.issues) {
          process.stderr.write(`- ${issue}\n`);
        }

        process.exitCode = 1;
        return;
      }

      throw error;
    }
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}\n`);
  process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  await main();
}
