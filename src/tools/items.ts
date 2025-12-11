/**
 * Items tools for Letta agents
 *
 * Provides tools for managing tasks, brain dumps, and subtasks:
 * - save_item: Save a new item to the database
 * - update_item: Update an existing item's status, content, or priority
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { registerTool, type ToolDefinition } from './dispatcher';

/**
 * Arguments for save_item tool
 */
export interface SaveItemArgs {
  /** Type of item to save */
  type: 'brain_dump' | 'task' | 'subtask';
  /** Item content */
  content: string;
  /** Optional priority (0-4, default 2) */
  priority?: number;
  /** Parent item ID for subtasks */
  parentId?: string;
}

/**
 * Result from save_item tool
 */
export interface SaveItemResult {
  /** ID of saved item */
  id: string;
  /** Success message */
  message: string;
}

/**
 * Arguments for update_item tool
 */
export interface UpdateItemArgs {
  /** ID of item to update */
  id: string;
  /** New status */
  status?: 'open' | 'in_progress' | 'done' | 'archived';
  /** Updated content */
  content?: string;
  /** Updated priority (0-4) */
  priority?: number;
}

/**
 * Result from update_item tool
 */
export interface UpdateItemResult {
  /** ID of updated item */
  id: string;
  /** Success message */
  message: string;
}

/**
 * save_item tool - Save a new task, brain dump, or subtask
 */
export const saveItemTool: ToolDefinition<SaveItemArgs, SaveItemResult> = registerTool({
  name: 'save_item',
  description: 'Save a new task, brain dump, or subtask to the database',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['brain_dump', 'task', 'subtask'],
        description: 'Type of item to save',
      },
      content: {
        type: 'string',
        description: 'Item content',
      },
      priority: {
        type: 'integer',
        minimum: 0,
        maximum: 4,
        description: 'Priority 0-4 (0=critical, 4=backlog, default 2=medium)',
      },
      parentId: {
        type: 'string',
        description: 'Parent item ID for subtasks',
      },
    },
    required: ['type', 'content'],
  },
  handler: async (args, context) => {
    // Generate a new UUID for the item
    const id = crypto.randomUUID();

    // Validate subtask has parentId
    if (
      args.type === 'subtask' &&
      (args.parentId === undefined || (typeof args.parentId === 'string' && args.parentId.length === 0))
    ) {
      throw new Error('Subtasks must have a parentId');
    }

    // Insert the item into the database
    await db.insert(schema.items).values({
      id,
      userId: context.userId,
      type: args.type,
      content: args.content,
      status: 'open',
      priority: args.priority ?? 2,
      parentId: args.parentId ?? null,
    });

    return {
      id,
      message: `Successfully saved ${args.type} with ID: ${id}`,
    };
  },
});

/**
 * update_item tool - Update an existing item
 */
export const updateItemTool: ToolDefinition<UpdateItemArgs, UpdateItemResult> = registerTool({
  name: 'update_item',
  description: "Update an existing item's status, content, or priority",
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Item ID to update',
      },
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'done', 'archived'],
        description: 'New status for the item',
      },
      content: {
        type: 'string',
        description: 'Updated content',
      },
      priority: {
        type: 'integer',
        minimum: 0,
        maximum: 4,
        description: 'Updated priority 0-4 (0=critical, 4=backlog)',
      },
    },
    required: ['id'],
  },
  handler: async (args, context) => {
    // First, verify the item exists and belongs to the user
    const existingItem = await db.query.items.findFirst({
      where: eq(schema.items.id, args.id),
    });

    if (!existingItem) {
      throw new Error(`Item with ID '${args.id}' not found`);
    }

    if (existingItem.userId !== context.userId) {
      throw new Error(`Item with ID '${args.id}' does not belong to user ${String(context.userId)}`);
    }

    // Build the update object with only provided fields
    const updates: {
      status?: 'open' | 'in_progress' | 'done' | 'archived';
      content?: string;
      priority?: number;
      updatedAt?: Date;
    } = {
      updatedAt: new Date(), // Always update the timestamp
    };

    if (args.status !== undefined) {
      updates.status = args.status;
    }
    if (args.content !== undefined) {
      updates.content = args.content;
    }
    if (args.priority !== undefined) {
      updates.priority = args.priority;
    }

    // Update the item in the database
    await db.update(schema.items).set(updates).where(eq(schema.items.id, args.id));

    return {
      id: args.id,
      message: `Successfully updated item ${args.id}`,
    };
  },
});
