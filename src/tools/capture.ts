/**
 * Capture tools for parsing and extracting structured data from brain dumps
 *
 * Implements the parse_brain_dump tool that extracts tasks and ideas
 * from free-form text input.
 */

import { registerTool, type ToolDefinition } from './dispatcher';
import { db, schema } from '../db';

/**
 * Arguments for parse_brain_dump tool
 */
export interface ParseBrainDumpArgs {
  /** Raw brain dump text from user */
  text: string;
}

/**
 * Result from parse_brain_dump tool
 */
export interface ParseBrainDumpResult {
  /** Extracted tasks with their IDs */
  tasks: {
    id: string;
    content: string;
    priority: number;
  }[];
  /** Extracted ideas with their IDs */
  ideas: {
    id: string;
    content: string;
  }[];
}

/**
 * Parse brain dump text to extract tasks and ideas
 *
 * Uses simple heuristics for M2:
 * - Lines starting with "- ", "* ", "TODO", numbers, or action verbs are tasks
 * - Other lines are ideas
 * - Strips common prefixes and cleans up text
 */
function parseBrainDump(text: string): { tasks: string[]; ideas: string[] } {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tasks: string[] = [];
  const ideas: string[] = [];

  // Common task prefixes to strip
  const taskPrefixes = [/^-\s+/, /^\*\s+/, /^\d+[).]\s+/, /^TODO:?\s*/i, /^TASK:?\s*/i];

  // Action verbs that indicate tasks
  const actionVerbs =
    /^(add|create|implement|fix|update|write|build|test|review|refactor|delete|remove|setup|configure|install|deploy|investigate|research|learn|study|call|email|message|buy|order|schedule|plan|organize|clean|finish|complete|start|begin)\b/i;

  for (const line of lines) {
    let content = line;
    let isTask = false;

    // Check for task prefixes
    for (const prefix of taskPrefixes) {
      if (prefix.test(content)) {
        content = content.replace(prefix, '');
        isTask = true;
        break;
      }
    }

    // If no prefix matched, check for action verbs
    if (!isTask && actionVerbs.test(content)) {
      isTask = true;
    }

    // Clean up content
    content = content.trim();

    if (content.length > 0) {
      if (isTask) {
        tasks.push(content);
      } else {
        ideas.push(content);
      }
    }
  }

  return { tasks, ideas };
}

/**
 * parse_brain_dump tool handler
 *
 * Extracts structured tasks and ideas from raw text and saves them to the database.
 */
export const parseBrainDumpTool: ToolDefinition<ParseBrainDumpArgs, ParseBrainDumpResult> = registerTool({
  name: 'parse_brain_dump',
  description: 'Extract tasks and ideas from a free-form brain dump text. Saves extracted items to database.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Raw brain dump text from user',
      },
    },
    required: ['text'],
  },
  handler: async (args, context) => {
    const { text } = args;
    const { userId } = context;

    // Parse the brain dump
    const { tasks: taskTexts, ideas: ideaTexts } = parseBrainDump(text);

    // Save tasks to database
    const tasks: ParseBrainDumpResult['tasks'] = [];
    for (const content of taskTexts) {
      const id = crypto.randomUUID();
      await db.insert(schema.items).values({
        id,
        userId,
        type: 'task',
        content,
        status: 'open',
        priority: 2, // Default medium priority
        parentId: null,
      });
      tasks.push({ id, content, priority: 2 });
    }

    // Save ideas to database
    const ideas: ParseBrainDumpResult['ideas'] = [];
    for (const content of ideaTexts) {
      const id = crypto.randomUUID();
      await db.insert(schema.items).values({
        id,
        userId,
        type: 'brain_dump',
        content,
        status: 'open',
        priority: 2,
        parentId: null,
      });
      ideas.push({ id, content });
    }

    console.log(`Parsed brain dump: ${String(tasks.length)} tasks, ${String(ideas.length)} ideas`);

    return { tasks, ideas };
  },
});
