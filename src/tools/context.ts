/**
 * Context tools for Letta agents
 *
 * Provides tools for retrieving contextual information about the user's state:
 * - get_open_items: Returns open/in-progress items for the user
 */

import { and, desc, eq, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { registerTool, type ToolDefinition } from './dispatcher';

/**
 * Arguments for get_open_items tool
 */
export interface GetOpenItemsArgs {
  /** Filter by item type (optional) */
  type?: 'brain_dump' | 'task' | 'subtask';
  /** Maximum number of items to return (default 10, max 50) */
  limit?: number;
}

/**
 * Result from get_open_items tool
 */
export interface GetOpenItemsResult {
  /** List of open/in-progress items */
  items: {
    id: string;
    type: 'brain_dump' | 'task' | 'subtask';
    content: string;
    status: 'open' | 'in_progress';
    priority: number;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
}

/**
 * Get open/in-progress items for the user
 *
 * This tool retrieves items that are currently open or in progress,
 * providing context about what the user is working on.
 */
export const getOpenItemsTool: ToolDefinition<GetOpenItemsArgs, GetOpenItemsResult> = registerTool({
  name: 'get_open_items',
  description:
    'Retrieve open or in-progress items for the user. Use this to understand what the user is currently working on or has pending.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['brain_dump', 'task', 'subtask'],
        description: 'Filter by item type (optional)',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of items to return (default 10)',
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    const limit = args.limit ?? 10;

    // Build query conditions
    const conditions = [
      eq(schema.items.userId, context.userId),
      or(eq(schema.items.status, 'open'), eq(schema.items.status, 'in_progress')),
    ];

    // Add type filter if specified
    if (args.type) {
      conditions.push(eq(schema.items.type, args.type));
    }

    // Query items
    const items = await db
      .select()
      .from(schema.items)
      .where(and(...conditions))
      .orderBy(schema.items.priority, desc(schema.items.createdAt))
      .limit(limit);

    // Return formatted result
    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        content: item.content,
        status: item.status as 'open' | 'in_progress',
        priority: item.priority,
        parentId: item.parentId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  },
});
