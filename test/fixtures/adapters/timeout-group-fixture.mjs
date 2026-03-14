/**
 * Fixture for testing process group kill (SIGTERM → SIGKILL escalation).
 *
 * This fixture spawns a grandchild process that ignores SIGTERM, and the
 * fixture itself also ignores SIGTERM. This simulates a shell wrapper
 * scenario where:
 *   - bash -c "opencode -p ..." (the shell is the direct child)
 *   - opencode (the grandchild, often a more stubborn process)
 *
 * The fixture only exits when the entire process group is killed with SIGKILL.
 *
 * Controlled by env var:
 *   FIXTURE_GRANDCHILD_DELAY_MS - how long grandchild sleeps (default: 60000)
 */

import { spawn } from "node:child_process";

const grandchildDelayMs = Number(process.env.FIXTURE_GRANDCHILD_DELAY_MS ?? 60000);

// Spawn a grandchild that ignores SIGTERM and sleeps for the specified duration
const grandchild = spawn(process.execPath, [
  "-e",
  `setTimeout(() => {}, ${grandchildDelayMs})`
]);

// Install a SIGTERM handler that does nothing — absorb the signal
process.on("SIGTERM", () => {
  // Intentionally do nothing — survive SIGTERM
});

// Wait for the grandchild to exit (which only happens on SIGKILL to the process group)
grandchild.once("close", () => {
  process.exit(0);
});
