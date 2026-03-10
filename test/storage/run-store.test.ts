import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { migrateDatabase } from "../../src/storage/migrate.js";
import { createRunStore } from "../../src/storage/run-store.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void>
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-bus-run-store-"));
  const databasePath = path.join(tempDir, "agent-bus.sqlite");

  try {
    await callback(databasePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("run store lists recent runs in descending creation order", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);

      const firstRun = runStore.createRun({
        runId: "run-001",
        status: "active",
        metadata: { workflow: "first" }
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const secondRun = runStore.createRun({
        runId: "run-002",
        status: "pending",
        metadata: { workflow: "second" }
      });

      assert.deepEqual(
        runStore.listRuns().map((run) => run.runId),
        ["run-002", "run-001"]
      );
      assert.deepEqual(
        runStore.listRuns({ limit: 1 }).map((run) => run.runId),
        ["run-002"]
      );
      assert.equal(runStore.getRun("run-001")?.metadata.workflow, "first");
      assert.equal(secondRun.status, "pending");
      assert.equal(firstRun.status, "active");
    } finally {
      database.close();
    }
  });
});

test("run store touchRun advances updatedAt monotonically", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      await migrateDatabase(database);

      const runStore = createRunStore(database);
      const created = runStore.createRun({
        runId: "run-touch-001",
        status: "active"
      });
      const firstTouch = runStore.touchRun("run-touch-001");
      const secondTouch = runStore.touchRun("run-touch-001");

      assert.ok(
        firstTouch.updatedAt > created.updatedAt,
        `expected first touch ${firstTouch.updatedAt} to advance beyond ${created.updatedAt}`
      );
      assert.ok(
        secondTouch.updatedAt > firstTouch.updatedAt,
        `expected second touch ${secondTouch.updatedAt} to advance beyond ${firstTouch.updatedAt}`
      );
    } finally {
      database.close();
    }
  });
});
