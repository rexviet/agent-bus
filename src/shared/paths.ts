import * as path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveRepositoryRoot(): string {
  return path.resolve(currentDir, "../..");
}
