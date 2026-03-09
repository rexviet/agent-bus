import {
  createRuntimeLayout,
  ensureRuntimeLayout,
  formatRuntimeLayout
} from "./shared/runtime-layout.js";

const HELP_TEXT = `agent-bus

Usage:
  agent-bus --help
  agent-bus layout
  agent-bus layout --ensure

Commands:
  layout          Print resolved runtime directories

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

  process.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}\n`);
  process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  await main();
}
