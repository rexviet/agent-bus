import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { migrateDatabase } from "../../src/storage/migrate.js";
import { openSqliteDatabase } from "../../src/storage/sqlite-client.js";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void>
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-bus-sqlite-"));
  const databasePath = path.join(tempDir, "agent-bus.sqlite");

  try {
    await callback(databasePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("openSqliteDatabase enables WAL and runs migrations idempotently", async () => {
  await withTempDatabase(async (databasePath) => {
    const database = openSqliteDatabase({ databasePath });

    try {
      const journalMode = database
        .prepare("PRAGMA journal_mode;")
        .get() as { journal_mode: string };

      assert.equal(journalMode.journal_mode.toLowerCase(), "wal");

      const firstRun = await migrateDatabase(database);
      const secondRun = await migrateDatabase(database);
      const appliedMigrations = database
        .prepare("SELECT id FROM schema_migrations ORDER BY id ASC;")
        .all()
        .map((row) => ({ id: (row as { id: string }).id }));

      assert.deepEqual(firstRun, ["001_initial.sql"]);
      assert.deepEqual(secondRun, []);
      assert.deepEqual(appliedMigrations, [{ id: "001_initial.sql" }]);
    } finally {
      database.close();
    }
  });
});
