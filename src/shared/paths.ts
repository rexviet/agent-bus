import * as path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, "../..");

export const WORKSPACE_DIRNAME = "workspace";
export const INTERNAL_DIRNAME = ".agent-bus";
export const STATE_DIRNAME = "state";
export const LOGS_DIRNAME = "logs";

export function resolveRepositoryRoot(): string {
  return repositoryRoot;
}

export function resolveFromRepositoryRoot(...segments: string[]): string {
  return path.resolve(repositoryRoot, ...segments);
}

export function toRepositoryRelativePath(targetPath: string): string {
  return path.relative(repositoryRoot, targetPath) || ".";
}
