import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import {
  INTERNAL_DIRNAME,
  LOGS_DIRNAME,
  STATE_DIRNAME,
  WORKSPACE_DIRNAME,
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

export interface RuntimeWorkspaceConfig {
  readonly artifactsDir: string;
  readonly stateDir: string;
  readonly logsDir: string;
}

export interface RuntimeLayoutOptions {
  readonly repositoryRoot?: string;
  readonly workspace?: RuntimeWorkspaceConfig;
}

function defaultWorkspaceConfig(): RuntimeWorkspaceConfig {
  return {
    artifactsDir: WORKSPACE_DIRNAME,
    stateDir: `${INTERNAL_DIRNAME}/${STATE_DIRNAME}`,
    logsDir: `${INTERNAL_DIRNAME}/${LOGS_DIRNAME}`
  };
}

function resolveWorkspacePath(repositoryRoot: string, relativePath: string): string {
  const resolvedPath = path.resolve(repositoryRoot, relativePath);
  const repositoryRelativePath = path.relative(repositoryRoot, resolvedPath);

  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(repositoryRelativePath)
  ) {
    throw new Error(`Workspace path must stay inside the repository: ${relativePath}`);
  }

  return resolvedPath;
}

function resolveInternalDir(
  repositoryRoot: string,
  stateDir: string,
  logsDir: string
): string {
  const stateSegments = path.relative(repositoryRoot, stateDir).split(path.sep).filter(Boolean);
  const logSegments = path.relative(repositoryRoot, logsDir).split(path.sep).filter(Boolean);
  const sharedSegments: string[] = [];
  const maxSharedLength = Math.min(stateSegments.length, logSegments.length);

  for (let index = 0; index < maxSharedLength; index += 1) {
    if (stateSegments[index] !== logSegments[index]) {
      break;
    }

    sharedSegments.push(stateSegments[index] as string);
  }

  return sharedSegments.length > 0
    ? path.resolve(repositoryRoot, ...sharedSegments)
    : repositoryRoot;
}

export function createRuntimeLayout(
  options: RuntimeLayoutOptions = {}
): RuntimeLayout {
  const repositoryRoot = resolveRepositoryRoot(options);
  const workspace = options.workspace ?? defaultWorkspaceConfig();
  const workspaceDir = resolveWorkspacePath(repositoryRoot, workspace.artifactsDir);
  const stateDir = resolveWorkspacePath(repositoryRoot, workspace.stateDir);
  const logsDir = resolveWorkspacePath(repositoryRoot, workspace.logsDir);
  const internalDir = resolveInternalDir(repositoryRoot, stateDir, logsDir);

  return {
    repositoryRoot,
    workspaceDir,
    internalDir,
    stateDir,
    logsDir
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
