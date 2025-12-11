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
 * Handles both structured (bullet points) and unstructured (stream-of-consciousness) text.
 * Extracts tasks based on:
 * - Explicit list markers (-, *, numbers, TODO)
 * - Intent phrases ("need to", "have to", "gotta", "should")
 * - Action verbs at sentence starts
 */
function parseBrainDump(text: string): { tasks: string[]; ideas: string[] } {
  const tasks: string[] = [];
  const ideas: string[] = [];

  // Common task prefixes to strip from list items
  const taskPrefixes = [/^-\s+/, /^\*\s+/, /^\d+[).]\s+/, /^TODO:?\s*/i, /^TASK:?\s*/i];

  // Action verbs that indicate tasks
  const actionVerbs =
    /^(add|create|implement|fix|update|write|build|test|review|refactor|delete|remove|setup|configure|install|deploy|investigate|research|learn|study|call|email|message|buy|order|schedule|plan|organize|clean|finish|complete|start|begin|send|check|get|make|do|prepare|submit|apply|respond|reply|contact|reach|follow|set|book|cancel|return|pick|drop)\b/i;

  // Intent phrases that signal tasks (captures "I need to X", "gotta X", etc.)
  const intentPatterns = [
    /\b(?:i\s+)?(?:need|have|got|gotta|should|must|want)\s+to\s+(\w+(?:\s+\w+){0,10}?)(?:\.|,|$|(?=\s+(?:and|but|i\s|i'm|also)))/gi,
    /\b(?:i'm|i\s+am)\s+(?:gonna|going\s+to)\s+(\w+(?:\s+\w+){0,10}?)(?:\.|,|$|(?=\s+(?:and|but|i\s|i'm|also)))/gi,
    /\bfinally\s+(\w+(?:\s+\w+){0,10}?)(?:\.|,|$|(?=\s+(?:and|but|i\s|i'm|also)))/gi,
  ];

  // First, try to extract tasks from intent phrases in unstructured text
  const extractedTasks = new Set<string>();
  for (const pattern of intentPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const task = match[1]?.trim() ?? '';
      if (task.length > 2 && task.length < 200) {
        // Clean up the task - capitalize first letter
        const cleanTask = task.charAt(0).toUpperCase() + task.slice(1);
        extractedTasks.add(cleanTask);
      }
    }
  }

  // Add extracted tasks
  for (const task of extractedTasks) {
    tasks.push(task);
  }

  // Then process line by line for structured input
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    let content = line;
    let isTask = false;

    // Check for task prefixes (bullet points, numbers)
    for (const prefix of taskPrefixes) {
      if (prefix.test(content)) {
        content = content.replace(prefix, '');
        isTask = true;
        break;
      }
    }

    // If no prefix matched, check for action verbs at line start
    if (!isTask && actionVerbs.test(content)) {
      isTask = true;
    }

    // Clean up content
    content = content.trim();

    if (content.length > 0) {
      if (isTask) {
        // Avoid duplicates from intent extraction
        if (!tasks.some((t) => t.toLowerCase() === content.toLowerCase())) {
          tasks.push(content);
        }
      } else if (tasks.length === 0) {
        // Only add as idea if we didn't extract any tasks from it
        // (to avoid storing the whole brain dump as an idea when we extracted tasks)
        ideas.push(content);
      }
    }
  }

  // If we extracted tasks but the whole text was one line, don't store it as an idea
  if (tasks.length > 0 && ideas.length === 1 && ideas[0] === text.trim()) {
    ideas.length = 0;
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
