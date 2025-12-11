/**
 * Tool: break_down_task
 *
 * Breaks down complex tasks into smaller, manageable subtasks.
 * This is crucial for ADHD users who get overwhelmed by large tasks.
 *
 * For M2, uses simple heuristics to identify natural breakpoints:
 * - Commas, semicolons
 * - Coordinating conjunctions (and, then, or)
 * - Numbered or bulleted lists
 * - Action verbs followed by objects
 */

import { registerTool, type ToolDefinition } from './dispatcher';
import { db, schema } from '../db';

/**
 * Arguments for break_down_task tool
 */
export interface BreakDownTaskArgs {
  /** Task description to break down */
  task: string;
  /** Optional parent task ID to link subtasks to */
  parentId?: string;
}

/**
 * Result from break_down_task tool
 */
export interface BreakDownTaskResult {
  /** Original task description */
  original: string;
  /** Broken down subtasks with IDs */
  subtasks: {
    id: string;
    content: string;
    order: number;
  }[];
}

/**
 * Break down a task into subtasks using simple heuristics
 *
 * Looks for natural breakpoints:
 * - Numbered lists (1. 2. 3. or 1) 2) 3))
 * - Bullet points (-, *, •)
 * - Commas and semicolons
 * - Conjunctions (and, then, after, before)
 *
 * @param task - Task description to break down
 * @returns Array of subtask strings
 */
function breakDownTaskText(task: string): string[] {
  const trimmed = task.trim();

  // Check for numbered lists: "1. do this 2. do that" or "1) do this 2) do that"
  const numberedListPattern = /(\d+[.)]\s+)/g;
  if (numberedListPattern.test(trimmed)) {
    const subtasks = trimmed
      .split(numberedListPattern)
      .filter((part) => !/^\d+[.)]\s*$/.exec(part)) // Remove the numbers themselves
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (subtasks.length > 1) {
      return subtasks;
    }
  }

  // Check for bullet points: "- item1\n- item2" or "* item1\n* item2"
  const bulletPattern = /^[\s]*[-*•]\s+/gm;
  if (bulletPattern.test(trimmed)) {
    const subtasks = trimmed
      .split('\n')
      .map((line) => line.replace(/^[\s]*[-*•]\s+/, '').trim())
      .filter((line) => line.length > 0);

    if (subtasks.length > 1) {
      return subtasks;
    }
  }

  // Check for comma-separated steps: "do this, do that, do another"
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    // Only split on commas if we get reasonable-length chunks (not mid-sentence commas)
    if (parts.length >= 2 && parts.every((part) => part.length > 5 && part.length < 100)) {
      return parts;
    }
  }

  // Check for semicolon-separated steps: "do this; do that; do another"
  if (trimmed.includes(';')) {
    const parts = trimmed.split(';').map((part) => part.trim());
    if (parts.length >= 2 && parts.every((part) => part.length > 0)) {
      return parts;
    }
  }

  // Check for conjunction-based splits: "do this and do that" or "do this then do that"
  const conjunctionPattern = /\s+(?:and|then|after|before|next)\s+/gi;
  const conjunctionMatch = trimmed.match(conjunctionPattern);
  if (conjunctionMatch && conjunctionMatch.length >= 1) {
    const parts = trimmed
      .split(conjunctionPattern)
      .map((part) => part.trim())
      .filter((part) => part.length > 5);

    if (parts.length >= 2) {
      return parts;
    }
  }

  // If no clear breakpoints found, return the original task as a single item
  // This indicates the task might already be atomic
  return [trimmed];
}

/**
 * Handler for break_down_task tool
 *
 * Breaks down a task and optionally saves subtasks to the database
 */
const breakDownTaskHandler = async (
  args: BreakDownTaskArgs,
  context: { userId: number }
): Promise<BreakDownTaskResult> => {
  const { task, parentId } = args;
  const { userId } = context;

  // Break down the task using heuristics
  const subtaskTexts = breakDownTaskText(task);

  // If parentId provided, save subtasks to database
  const subtasks: { id: string; content: string; order: number }[] = [];

  if (parentId !== undefined && parentId.length > 0) {
    // Create subtask records in database
    for (let i = 0; i < subtaskTexts.length; i++) {
      const subtaskContent = subtaskTexts[i];
      if (subtaskContent === undefined || subtaskContent.length === 0) {
        continue; // Skip undefined/empty entries
      }

      const subtaskId = crypto.randomUUID();

      await db.insert(schema.items).values({
        id: subtaskId,
        userId,
        type: 'subtask',
        content: subtaskContent,
        status: 'open',
        priority: 2, // Default priority
        parentId,
      });

      subtasks.push({
        id: subtaskId,
        content: subtaskContent,
        order: i + 1,
      });
    }
  } else {
    // Just return the breakdown without saving
    for (let i = 0; i < subtaskTexts.length; i++) {
      const subtaskContent = subtaskTexts[i];
      if (subtaskContent === undefined || subtaskContent.length === 0) {
        continue; // Skip undefined/empty entries
      }

      subtasks.push({
        id: crypto.randomUUID(), // Generate ID but don't save
        content: subtaskContent,
        order: i + 1,
      });
    }
  }

  return {
    original: task,
    subtasks,
  };
};

/**
 * Tool definition for break_down_task
 */
export const breakDownTaskTool: ToolDefinition<BreakDownTaskArgs, BreakDownTaskResult> = {
  name: 'break_down_task',
  description:
    'Breaks down a complex task into smaller, manageable subtasks. Use this when a user provides a large or overwhelming task. Can optionally save subtasks to database if parentId is provided.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description to break down into smaller steps',
      },
      parentId: {
        type: 'string',
        description: 'Optional parent task ID to link subtasks to (will save subtasks to database)',
      },
    },
    required: ['task'],
  },
  handler: breakDownTaskHandler,
};

// Register the tool with the dispatcher
registerTool(breakDownTaskTool);
