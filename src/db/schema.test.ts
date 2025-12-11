/**
 * Tests for database schema
 */

import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from './index';

describe('Database Schema', () => {
  test('db instance is defined', () => {
    expect(db).toBeDefined();
  });

  test('schema exports items table', () => {
    expect(schema.items).toBeDefined();
  });

  test('can insert and query items', async () => {
    // Insert a test item
    const testItem = {
      id: `test-${Date.now().toString()}`,
      userId: 12345,
      type: 'task' as const,
      content: 'Test task',
      status: 'open' as const,
      priority: 2,
    };

    await db.insert(schema.items).values(testItem);

    // Query it back
    const result = await db.select().from(schema.items).where(eq(schema.items.id, testItem.id));

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(testItem.id);
    expect(result[0]?.userId).toBe(testItem.userId);
    expect(result[0]?.type).toBe('task');
    expect(result[0]?.content).toBe('Test task');
    expect(result[0]?.status).toBe('open');
    expect(result[0]?.priority).toBe(2);

    // Clean up
    await db.delete(schema.items).where(eq(schema.items.id, testItem.id));
  });

  test('supports hierarchical tasks with parentId', async () => {
    const parentId = `parent-${Date.now().toString()}`;
    const childId = `child-${Date.now().toString()}`;

    // Create parent task
    await db.insert(schema.items).values({
      id: parentId,
      userId: 12345,
      type: 'task',
      content: 'Parent task',
    });

    // Create child subtask
    await db.insert(schema.items).values({
      id: childId,
      userId: 12345,
      type: 'subtask',
      content: 'Child subtask',
      parentId: parentId,
    });

    // Query child
    const children = await db.select().from(schema.items).where(eq(schema.items.parentId, parentId));

    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(childId);
    expect(children[0]?.parentId).toBe(parentId);

    // Clean up
    await db.delete(schema.items).where(eq(schema.items.id, childId));
    await db.delete(schema.items).where(eq(schema.items.id, parentId));
  });
});
