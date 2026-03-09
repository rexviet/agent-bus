import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";

import {
  createRuntimeLayout,
  type RuntimeLayoutOptions
} from "../shared/runtime-layout.js";

export const DEFAULT_DATABASE_FILENAME = "agent-bus.sqlite";

export interface SqliteClientOptions extends RuntimeLayoutOptions {
  readonly databasePath?: string;
}

export function resolveDefaultDatabasePath(
  options: RuntimeLayoutOptions = {}
): string {
  const layout = createRuntimeLayout(options);

  return path.resolve(layout.stateDir, DEFAULT_DATABASE_FILENAME);
}

export function openSqliteDatabase(
  options: SqliteClientOptions = {}
): DatabaseSync {
  const databasePath = options.databasePath ?? resolveDefaultDatabasePath(options);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");

  return database;
}
