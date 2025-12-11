/**
 * Drizzle Kit configuration
 *
 * Configuration for Drizzle's migration generator and other CLI tools.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/assistant.db',
  },
});
