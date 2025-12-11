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
import { config } from '../config';

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
/**
 * Generate Python function signature from JSON schema parameters
 */
function generatePythonParams(parameters: Record<string, unknown>): {
  signature: string;
  docParams: string;
  argsDict: string;
} {
  const propsRaw = parameters['properties'];
  const props = (propsRaw as Record<string, Record<string, unknown>> | undefined) ?? {};
  const requiredRaw = parameters['required'];
  const required = (requiredRaw as string[] | undefined) ?? [];

  const params: string[] = [];
  const docLines: string[] = [];
  const dictEntries: string[] = [];

  for (const [name, schema] of Object.entries(props)) {
    const pyType = schema['type'] === 'integer' ? 'int' : schema['type'] === 'boolean' ? 'bool' : 'str';
    const isRequired = required.includes(name);
    const descRaw = schema['description'];
    const desc = typeof descRaw === 'string' ? descRaw : '';

    if (isRequired) {
      params.push(`${name}: ${pyType}`);
    } else {
      params.push(`${name}: ${pyType} = None`);
    }

    docLines.push(`        ${name}: ${desc}`);
    dictEntries.push(`"${name}": ${name}`);
  }

  return {
    signature: params.join(', '),
    docParams: docLines.length > 0 ? '\n\n    Args:\n' + docLines.join('\n') : '',
    argsDict: dictEntries.join(', '),
  };
}

export function toLettaToolCreate(definition: ToolDefinition): ToolCreateParams {
  // Generate Python source code that Letta can execute
  // Tools are proxied through a webhook to our Bun handlers
  const webhookUrl = config.TOOL_WEBHOOK_URL;

  // Generate explicit parameters from JSON schema so Letta knows what args to pass
  const { signature, docParams, argsDict } = generatePythonParams(definition.parameters);

  const sourceCode = `
def ${definition.name}(${signature}):
    """${definition.description}${docParams}
    """
    import requests

    webhook_url = "${webhookUrl}"
    args = {${argsDict}}

    try:
        response = requests.post(
            f"{webhook_url}/tools/${definition.name}",
            json=args,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return {"error": str(e)}
`.trim();

  // Letta's json_schema format: flat object with name, description, parameters
  // (different from OpenAI's nested {type: 'function', function: {...}} format)
  return {
    source_code: sourceCode,
    description: definition.description,
    source_type: 'python',
    pip_requirements: [{ name: 'requests' }],
    json_schema: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
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
