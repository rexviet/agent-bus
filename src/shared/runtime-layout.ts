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

export function createRuntimeLayout(): RuntimeLayout {
  const repositoryRoot = resolveRepositoryRoot();
  const internalDir = resolveFromRepositoryRoot(INTERNAL_DIRNAME);

  return {
    repositoryRoot,
    workspaceDir: resolveFromRepositoryRoot(WORKSPACE_DIRNAME),
    internalDir,
    stateDir: resolveFromRepositoryRoot(INTERNAL_DIRNAME, STATE_DIRNAME),
    logsDir: resolveFromRepositoryRoot(INTERNAL_DIRNAME, LOGS_DIRNAME)
  };
}

export async function ensureRuntimeLayout(): Promise<RuntimeLayout> {
  const layout = createRuntimeLayout();

  await Promise.all([
    mkdir(layout.workspaceDir, { recursive: true }),
    mkdir(layout.stateDir, { recursive: true }),
    mkdir(layout.logsDir, { recursive: true })
  ]);

  return layout;
}

export function formatRuntimeLayout(layout: RuntimeLayout): string {
  return [
    `repositoryRoot: ${toRepositoryRelativePath(layout.repositoryRoot)}`,
    `workspaceDir: ${toRepositoryRelativePath(layout.workspaceDir)}`,
    `internalDir: ${toRepositoryRelativePath(layout.internalDir)}`,
    `stateDir: ${toRepositoryRelativePath(layout.stateDir)}`,
    `logsDir: ${toRepositoryRelativePath(layout.logsDir)}`
  ].join("\n");
}
