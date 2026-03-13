/**
 * Fixture adapter for process monitoring tests.
 * Controlled by env vars or arguments:
 *   FIXTURE_STDOUT_LINES - comma-separated lines to write to stdout (default: "hello stdout")
 *   FIXTURE_STDERR_LINES - comma-separated lines to write to stderr (default: "")
 *   FIXTURE_DELAY_MS - milliseconds to sleep before finishing (default: 0)
 *   FIXTURE_EXIT_CODE - exit code (default: 0)
 */

const stdoutLines = process.env.FIXTURE_STDOUT_LINES
  ? process.env.FIXTURE_STDOUT_LINES.split(",")
  : ["hello stdout"];
const stderrLines = process.env.FIXTURE_STDERR_LINES
  ? process.env.FIXTURE_STDERR_LINES.split(",")
  : [];
const delayMs = Number(process.env.FIXTURE_DELAY_MS ?? 0);
const exitCode = Number(process.env.FIXTURE_EXIT_CODE ?? 0);

for (const line of stdoutLines) {
  process.stdout.write(`${line}\n`);
}

for (const line of stderrLines) {
  process.stderr.write(`${line}\n`);
}

if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

process.exit(exitCode);
