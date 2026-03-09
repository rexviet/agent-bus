import * as path from "node:path";

import { z } from "zod";

import type { RuntimeLayout } from "../shared/runtime-layout.js";

const normalizedSeparatorPattern = /\\/g;

export function normalizeArtifactRefPath(rawPath: string): string {
  const trimmedPath = rawPath.trim();

  if (trimmedPath.length === 0) {
    throw new Error("Artifact path must not be empty.");
  }

  if (path.isAbsolute(trimmedPath)) {
    throw new Error(`Artifact path must be relative: ${rawPath}`);
  }

  const normalizedPath = path.posix.normalize(
    trimmedPath.replace(normalizedSeparatorPattern, "/")
  );

  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new Error(`Artifact path must stay inside the shared workspace: ${rawPath}`);
  }

  return normalizedPath;
}

export function resolveArtifactRefPath(
  layout: RuntimeLayout,
  artifactPath: string
): string {
  const normalizedPath = normalizeArtifactRefPath(artifactPath);

  return path.resolve(layout.workspaceDir, normalizedPath);
}

export const ArtifactRefSchema = z.object({
  path: z.string().min(1).transform((value, ctx) => {
    try {
      return normalizeArtifactRefPath(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid artifact path."
      });

      return z.NEVER;
    }
  }),
  description: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
  role: z.string().min(1).optional()
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
