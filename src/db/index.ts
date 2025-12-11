/**
 * Database initialization and connection
 *
 * Sets up SQLite database with Drizzle ORM using bun:sqlite
 */

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config';
import * as schema from './schema';

/**
 * Initialize the database connection
 *
 * Creates the parent directory if it doesn't exist.
 * Returns a Drizzle database instance configured for bun:sqlite.
 */
async function initDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const dbPath = config.DB_PATH;

  // Create parent directory if it doesn't exist
  const dir = dirname(dbPath);
  await mkdir(dir, { recursive: true });

  // Open SQLite connection with bun:sqlite
  const sqlite = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent access
  sqlite.run('PRAGMA journal_mode = WAL;');

  // Create Drizzle instance
  const db = drizzle(sqlite, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './src/db/migrations' });

  return db;
}

/**
 * Database instance
 *
 * Singleton instance of the Drizzle database.
 * Initialized on first import.
 */
export const db = await initDb();

/**
 * Export schema for use in queries
 */
export { schema };
