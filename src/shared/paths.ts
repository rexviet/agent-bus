import * as path from "node:path";

export const WORKSPACE_DIRNAME = "workspace";
export const INTERNAL_DIRNAME = ".agent-bus";
export const STATE_DIRNAME = "state";
export const LOGS_DIRNAME = "logs";

export interface PathResolutionOptions {
  readonly repositoryRoot?: string;
}

export function resolveRepositoryRoot(
  options: PathResolutionOptions = {}
): string {
  return path.resolve(options.repositoryRoot ?? process.cwd());
}

export function resolveFromRepositoryRoot(
  segments: readonly string[],
  options: PathResolutionOptions = {}
): string {
  return path.resolve(resolveRepositoryRoot(options), ...segments);
}

export function toRepositoryRelativePath(
  targetPath: string,
  options: PathResolutionOptions = {}
): string {
  return path.relative(resolveRepositoryRoot(options), targetPath) || ".";
}
