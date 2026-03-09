import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";

import { createRuntimeLayout } from "../shared/runtime-layout.js";

export const DEFAULT_DATABASE_FILENAME = "agent-bus.sqlite";

export interface SqliteClientOptions {
  readonly databasePath?: string;
}

export function resolveDefaultDatabasePath(): string {
  const layout = createRuntimeLayout();

  return path.resolve(layout.stateDir, DEFAULT_DATABASE_FILENAME);
}

export function openSqliteDatabase(
  options: SqliteClientOptions = {}
): DatabaseSync {
  const databasePath = options.databasePath ?? resolveDefaultDatabasePath();
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");

  return database;
}
