/**
 * System prompt loader with dynamic tool injection
 *
 * Loads the system prompt from a markdown file and injects
 * the available tools from the tool registry.
 */

import { toolRegistry } from './tools';

/**
 * Path to the system prompt template
 */
const SYSTEM_PROMPT_PATH = new URL('../prompts/SYSTEM_PROMPT.md', import.meta.url).pathname;

/**
 * Format a tool definition as a bullet point for the prompt
 */
function formatToolForPrompt(name: string, description: string): string {
  return `- ${name}: ${description}`;
}

/**
 * Generate the tools section from the registry
 */
function generateToolsSection(): string {
  const tools = toolRegistry.getAll();

  if (tools.length === 0) {
    return '(No tools registered yet)';
  }

  return tools.map((tool) => formatToolForPrompt(tool.name, tool.description)).join('\n');
}

/**
 * Load the system prompt from file and inject tools
 *
 * @returns The complete system prompt with tools injected
 */
export async function loadSystemPrompt(): Promise<string> {
  const templateFile = Bun.file(SYSTEM_PROMPT_PATH);
  const template = await templateFile.text();

  const toolsSection = generateToolsSection();
  const prompt = template.replace('{{TOOLS}}', toolsSection);

  return prompt;
}
