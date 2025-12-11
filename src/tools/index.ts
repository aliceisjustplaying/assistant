/**
 * Tools module for Letta agents
 *
 * This module provides tool definitions and handlers for ADHD support features:
 * - parse_brain_dump: Extract tasks and ideas from free-form text
 * - break_down_task: Decompose complex tasks into manageable steps
 * - save_item: Save a task, idea, or reminder
 * - update_item: Update an existing item's status or details
 * - get_open_items: Retrieve open tasks and reminders
 *
 * Tools are registered with the dispatcher and can be attached to Letta agents.
 */

// Export dispatcher types and functions
export {
  type ToolContext,
  type ToolHandler,
  type ToolDefinition,
  toolRegistry,
  dispatchTool,
  toLettaToolCreate,
  getAllLettaToolsCreate,
  registerTool,
} from './dispatcher';

// Placeholder types for future tool implementations
// These will be implemented in subsequent tasks

/**
 * Arguments for parse_brain_dump tool
 */
export interface ParseBrainDumpArgs {
  /** Free-form text dump from user */
  text: string;
}

/**
 * Result from parse_brain_dump tool
 */
export interface ParseBrainDumpResult {
  /** Extracted tasks */
  tasks: {
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
  }[];
  /** Extracted ideas or notes */
  ideas: {
    content: string;
  }[];
}

/**
 * Arguments for break_down_task tool
 */
export interface BreakDownTaskArgs {
  /** Task description to break down */
  task: string;
  /** Optional parent task ID */
  parentId?: string;
}

/**
 * Result from break_down_task tool
 */
export interface BreakDownTaskResult {
  /** Original task */
  original: string;
  /** Broken down subtasks */
  subtasks: {
    id: string;
    content: string;
    order: number;
  }[];
}

/**
 * Arguments for save_item tool
 */
export interface SaveItemArgs {
  /** Type of item to save */
  type: 'task' | 'idea' | 'reminder';
  /** Item title or content */
  title: string;
  /** Optional description */
  description?: string;
  /** Optional priority for tasks */
  priority?: 'low' | 'medium' | 'high';
  /** Optional due date (ISO 8601 string) */
  dueDate?: string;
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
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled';
  /** Updated title */
  title?: string;
  /** Updated description */
  description?: string;
  /** Updated priority */
  priority?: 'low' | 'medium' | 'high';
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
 * Arguments for get_open_items tool
 */
export interface GetOpenItemsArgs {
  /** Filter by type (optional) */
  type?: 'task' | 'idea' | 'reminder';
  /** Maximum number of items to return */
  limit?: number;
}

/**
 * Result from get_open_items tool
 */
export interface GetOpenItemsResult {
  /** List of open items */
  items: {
    id: string;
    type: 'task' | 'idea' | 'reminder';
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
    status: 'open' | 'in_progress';
    createdAt: string;
    dueDate?: string;
  }[];
}

// Import tool implementations
import './items';
import './capture';
import './context';
import './breakdown';
