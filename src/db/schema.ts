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

/**
 * Wins table - stores tiny wins for positive reinforcement
 *
 * Tracks small accomplishments to build momentum and combat ADHD-related
 * feelings of underachievement.
 */
export const wins = sqliteTable('wins', {
  id: text('id').primaryKey().notNull(),
  userId: integer('user_id').notNull(), // Telegram user ID
  content: text('content').notNull(), // What the user accomplished
  category: text('category', { enum: ['task', 'habit', 'self_care', 'social', 'work', 'creative', 'other'] })
    .notNull()
    .default('other'),
  magnitude: text('magnitude', { enum: ['tiny', 'small', 'medium', 'big'] })
    .notNull()
    .default('tiny'), // How significant the win is
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Type for inserting new wins
 */
export type InsertWin = typeof wins.$inferInsert;

/**
 * Type for selecting wins from the database
 */
export type SelectWin = typeof wins.$inferSelect;
