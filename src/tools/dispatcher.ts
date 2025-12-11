/**
 * Tool dispatcher for Letta agents
 *
 * This module provides:
 * - Type definitions for tool handlers
 * - Tool registry for managing available tools
 * - Dispatcher for routing tool calls to appropriate handlers
 * - Letta-compatible tool definitions for agent creation
 */

import type { ToolCreateParams } from '@letta-ai/letta-client/resources/tools.js';

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  /** Telegram user ID of the user invoking the tool */
  userId: number;
}

/**
 * A tool handler function that processes tool calls
 *
 * @param args - Tool arguments (validated against JSON schema)
 * @param context - Context information (user ID, etc.)
 * @returns Tool result (serializable to JSON)
 */
export type ToolHandler<TArgs = unknown, TResult = unknown> = (args: TArgs, context: ToolContext) => Promise<TResult>;

/**
 * Tool definition for registration
 */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  /** Tool name (must match Letta tool name) */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema for tool parameters */
  parameters: Record<string, unknown>;

  /** Handler function to execute when tool is called */
  handler: ToolHandler<TArgs, TResult>;
}

/**
 * Registry of available tools
 */
class ToolRegistry {
  // Use unknown for the map to accept any generic parameters
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool with the dispatcher
   *
   * @param definition - Tool definition including handler
   */
  register<TArgs, TResult>(definition: ToolDefinition<TArgs, TResult>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' is already registered`);
    }

    // Cast to unknown to allow any generic parameters
    this.tools.set(definition.name, definition as ToolDefinition);
    console.log(`Registered tool: ${definition.name}`);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool definition or undefined if not found
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   *
   * @returns Array of all tool definitions
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool is registered
   *
   * @param name - Tool name
   * @returns True if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Clear all registered tools (primarily for testing)
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Singleton tool registry instance
 */
export const toolRegistry = new ToolRegistry();

/**
 * Dispatch a tool call to the appropriate handler
 *
 * @param name - Tool name
 * @param args - Tool arguments (should match tool's JSON schema)
 * @param context - Tool execution context
 * @returns Tool execution result
 * @throws Error if tool is not found or execution fails
 */
export async function dispatchTool(name: string, args: unknown, context: ToolContext): Promise<unknown> {
  const tool = toolRegistry.get(name);

  if (!tool) {
    throw new Error(`Tool '${name}' is not registered`);
  }

  try {
    console.log(`Dispatching tool: ${name}`, { args, userId: context.userId });
    const result = await tool.handler(args, context);
    console.log(`Tool '${name}' executed successfully`);
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Tool '${name}' execution failed:`, error);
    throw new Error(`Failed to execute tool '${name}': ${errorMessage}`);
  }
}

/**
 * Convert a tool definition to Letta-compatible format
 *
 * This generates the source code and parameters that Letta needs
 * to register the tool on the Letta server.
 *
 * @param definition - Tool definition
 * @returns Letta tool creation parameters
 */
export function toLettaToolCreate(definition: ToolDefinition): ToolCreateParams {
  // Generate Python source code that Letta can execute
  // For now, tools will be proxied through a webhook/API call
  // that dispatches back to our Node.js handlers
  const sourceCode = `
def ${definition.name}(**kwargs):
    """${definition.description}"""
    # This is a placeholder - actual execution happens via webhook
    # to the Node.js dispatcher
    import os
    import requests

    webhook_url = os.environ.get('TOOL_WEBHOOK_URL')
    if not webhook_url:
        return {"error": "TOOL_WEBHOOK_URL not configured"}

    try:
        response = requests.post(
            f"{webhook_url}/tools/${definition.name}",
            json=kwargs,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e)}
`.trim();

  return {
    source_code: sourceCode,
    description: definition.description,
    json_schema: {
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      },
    },
    source_type: 'python',
    pip_requirements: [{ name: 'requests' }],
  };
}

/**
 * Get all registered tools in Letta-compatible format
 *
 * @returns Array of Letta tool creation parameters
 */
export function getAllLettaToolsCreate(): ToolCreateParams[] {
  return toolRegistry.getAll().map(toLettaToolCreate);
}

/**
 * Register a tool and return its definition for chaining
 *
 * @param definition - Tool definition
 * @returns The same tool definition for convenience
 */
export function registerTool<TArgs = unknown, TResult = unknown>(
  definition: ToolDefinition<TArgs, TResult>
): ToolDefinition<TArgs, TResult> {
  toolRegistry.register<TArgs, TResult>(definition);
  return definition;
}
