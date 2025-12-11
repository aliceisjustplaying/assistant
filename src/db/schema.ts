/**
 * Database schema for ADHD Support Assistant
 *
 * Defines the SQLite database schema using Drizzle ORM.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Items table - stores tasks, brain dumps, and subtasks
 *
 * Supports hierarchical task breakdown with parent-child relationships
 */
export const items = sqliteTable('items', {
  id: text('id').primaryKey().notNull(),
  userId: integer('user_id').notNull(), // Telegram user ID
  type: text('type', { enum: ['brain_dump', 'task', 'subtask'] }).notNull(),
  content: text('content').notNull(),
  status: text('status', { enum: ['open', 'in_progress', 'done', 'archived'] })
    .notNull()
    .default('open'),
  priority: integer('priority').notNull().default(2), // 0-4, like beads
  parentId: text('parent_id'), // nullable, for subtasks
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Type for inserting new items
 */
export type InsertItem = typeof items.$inferInsert;

/**
 * Type for selecting items from the database
 */
export type SelectItem = typeof items.$inferSelect;
