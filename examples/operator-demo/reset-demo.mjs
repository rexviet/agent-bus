import { rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

const pathsToRemove = [
  ".agent-bus/demo-state",
  ".agent-bus/demo-logs",
  "examples/operator-demo/workspace/docs/system-design.md",
  "examples/operator-demo/workspace/docs/test-cases.md"
];

for (const relativePath of pathsToRemove) {
  await rm(path.join(repositoryRoot, relativePath), {
    recursive: true,
    force: true
  });
  process.stdout.write(`Removed ${relativePath}\n`);
}
