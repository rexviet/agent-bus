import { mkdir } from "node:fs/promises";

import {
  INTERNAL_DIRNAME,
  LOGS_DIRNAME,
  STATE_DIRNAME,
  WORKSPACE_DIRNAME,
  resolveFromRepositoryRoot,
  resolveRepositoryRoot,
  toRepositoryRelativePath
} from "./paths.js";

export interface RuntimeLayout {
  readonly repositoryRoot: string;
  readonly workspaceDir: string;
  readonly internalDir: string;
  readonly stateDir: string;
  readonly logsDir: string;
}

export interface RuntimeLayoutOptions {
  readonly repositoryRoot?: string;
}

export function createRuntimeLayout(
  options: RuntimeLayoutOptions = {}
): RuntimeLayout {
  const repositoryRoot = resolveRepositoryRoot(options);
  const internalDir = resolveFromRepositoryRoot([INTERNAL_DIRNAME], options);

  return {
    repositoryRoot,
    workspaceDir: resolveFromRepositoryRoot([WORKSPACE_DIRNAME], options),
    internalDir,
    stateDir: resolveFromRepositoryRoot([INTERNAL_DIRNAME, STATE_DIRNAME], options),
    logsDir: resolveFromRepositoryRoot([INTERNAL_DIRNAME, LOGS_DIRNAME], options)
  };
}

export async function ensureRuntimeLayout(
  options: RuntimeLayoutOptions = {}
): Promise<RuntimeLayout> {
  const layout = createRuntimeLayout(options);

  await Promise.all([
    mkdir(layout.workspaceDir, { recursive: true }),
    mkdir(layout.stateDir, { recursive: true }),
    mkdir(layout.logsDir, { recursive: true })
  ]);

  return layout;
}

export function formatRuntimeLayout(layout: RuntimeLayout): string {
  return [
    `repositoryRoot: ${toRepositoryRelativePath(layout.repositoryRoot, { repositoryRoot: layout.repositoryRoot })}`,
    `workspaceDir: ${toRepositoryRelativePath(layout.workspaceDir, { repositoryRoot: layout.repositoryRoot })}`,
    `internalDir: ${toRepositoryRelativePath(layout.internalDir, { repositoryRoot: layout.repositoryRoot })}`,
    `stateDir: ${toRepositoryRelativePath(layout.stateDir, { repositoryRoot: layout.repositoryRoot })}`,
    `logsDir: ${toRepositoryRelativePath(layout.logsDir, { repositoryRoot: layout.repositoryRoot })}`
  ].join("\n");
}
