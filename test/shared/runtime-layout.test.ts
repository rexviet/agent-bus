import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import {
  createRuntimeLayout,
  formatRuntimeLayout
} from "../../src/shared/runtime-layout.js";
import { resolveDefaultDatabasePath } from "../../src/storage/sqlite-client.js";

test("createRuntimeLayout resolves manifest-configured workspace paths", () => {
  const repositoryRoot = path.resolve("/tmp/agent-bus-layout");
  const layout = createRuntimeLayout({
    repositoryRoot,
    workspace: {
      artifactsDir: "shared-workspace",
      stateDir: ".runtime/state-store",
      logsDir: ".runtime/log-output"
    }
  });

  assert.equal(layout.workspaceDir, path.join(repositoryRoot, "shared-workspace"));
  assert.equal(layout.stateDir, path.join(repositoryRoot, ".runtime", "state-store"));
  assert.equal(layout.logsDir, path.join(repositoryRoot, ".runtime", "log-output"));
  assert.equal(layout.internalDir, path.join(repositoryRoot, ".runtime"));
  assert.match(formatRuntimeLayout(layout), /workspaceDir: shared-workspace/);
});

test("resolveDefaultDatabasePath follows manifest-configured state directory", () => {
  const repositoryRoot = path.resolve("/tmp/agent-bus-layout-db");
  const databasePath = resolveDefaultDatabasePath({
    repositoryRoot,
    workspace: {
      artifactsDir: "workspace",
      stateDir: ".state/runtime-data",
      logsDir: ".state/logs"
    }
  });

  assert.equal(
    databasePath,
    path.join(repositoryRoot, ".state", "runtime-data", "agent-bus.sqlite")
  );
});
