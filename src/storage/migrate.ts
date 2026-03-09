import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseSync } from "node:sqlite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "migrations");

interface MigrationRow {
  id: string;
}

export async function migrateDatabase(database: DatabaseSync): Promise<string[]> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const selectApplied = database.prepare(
    "SELECT id FROM schema_migrations ORDER BY id ASC"
  );
  const insertApplied = database.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  );
  const appliedIds = new Set(
    selectApplied.all().map((row) => (row as unknown as MigrationRow).id)
  );
  const appliedMigrations: string[] = [];

  for (const migrationFile of migrationFiles) {
    if (appliedIds.has(migrationFile)) {
      continue;
    }

    const migrationSql = await readFile(path.resolve(migrationsDir, migrationFile), "utf8");
    const appliedAt = new Date().toISOString();

    database.exec("BEGIN");

    try {
      database.exec(migrationSql);
      insertApplied.run(migrationFile, appliedAt);
      database.exec("COMMIT");
      appliedMigrations.push(migrationFile);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return appliedMigrations;
}
