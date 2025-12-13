/**
 * Telegram bot implementation using Telegraf
 *
 * Handles:
 * - Message processing and routing to Letta
 * - Bot commands (/start, /help)
 * - User-specific agent management
 * - Error handling and user-friendly responses
 */

import { Telegraf, type Context } from 'telegraf';
import type { Update } from 'telegraf/types';
import { config } from './config';
import { detectAndParse, formatDetectionContext } from './detect';
import { getLettaClient, getRegisteredToolIds } from './letta';
import { loadSystemPrompt } from './prompts';

/**
 * Create Telegraf bot instance
 */
export const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

/**
 * Single agent ID for the bot (found or created on startup)
 */
let agentId: string | null = null;

const AGENT_NAME = 'adhd-support-agent';

/**
 * Sync any missing tools to an existing agent
 *
 * Compares registered tools with agent's attached tools and attaches any missing ones.
 */
async function syncToolsToAgent(client: ReturnType<typeof getLettaClient>, agentId: string): Promise<void> {
  const registeredToolIds = getRegisteredToolIds();
  if (registeredToolIds.length === 0) {
    return;
  }

  // Get currently attached tools
  const attachedTools = new Set<string>();
  for await (const tool of client.agents.tools.list(agentId)) {
    attachedTools.add(tool.id);
  }

  // Attach any missing tools
  let attached = 0;
  for (const toolId of registeredToolIds) {
    if (!attachedTools.has(toolId)) {
      try {
        await client.agents.tools.attach(toolId, { agent_id: agentId });
        attached++;
      } catch (err) {
        console.warn(`Failed to attach tool ${toolId}:`, err);
      }
    }
  }

  if (attached > 0) {
    console.log(`Attached ${String(attached)} new tools to existing agent`);
  }
}

/**
 * Get or create the single ADHD support agent
 *
 * Searches for existing agent by name, creates if not found.
 * This ensures we reuse the same agent across restarts.
 *
 * @returns Agent ID
 */
async function getOrCreateAgent(): Promise<string> {
  if (agentId !== null) {
    return agentId;
  }

  const client = getLettaClient();

  try {
    // Search for existing agent by name
    console.log(`Looking for existing agent '${AGENT_NAME}'...`);
    for await (const agent of client.agents.list()) {
      if (agent.name === AGENT_NAME) {
        console.log(`Found existing agent: ${agent.id}`);
        agentId = agent.id;

        // Sync any missing tools to the existing agent
        await syncToolsToAgent(client, agentId);

        return agentId;
      }
    }

    // No existing agent found, create one
    console.log(`No existing agent found, creating '${AGENT_NAME}'...`);

    // Get registered tool IDs to attach to this agent
    const toolIds = getRegisteredToolIds();
    console.log(`Will attach ${String(toolIds.length)} tools to new agent`);

    // Load system prompt from file with dynamic tool injection
    const systemPrompt = await loadSystemPrompt();

    // Workaround for Letta bug: openai-proxy/ handles are rejected during creation
    // but work when set via llm_config modification.
    // Step 1: Create agent with letta-free model (tools attached separately in step 3)
    const agentState = await client.agents.create({
      name: AGENT_NAME,
      description: 'ADHD support agent for task management and gentle accountability',
      model: 'letta/letta-free',
      embedding: 'letta/letta-free',
      memory_blocks: [
        {
          label: 'persona',
          value: systemPrompt,
        },
        {
          label: 'human',
          value: 'A person with ADHD who needs help managing tasks and staying focused.',
        },
      ],
    });

    console.log(`Created agent ${agentState.id} with letta-free, modifying to use Claude...`);

    // Step 2: Update agent to use Claude Opus 4.5 via LiteLLM proxy
    await client.agents.update(agentState.id, {
      llm_config: {
        handle: 'openai/claude-opus-4-5-20251101',
        model: 'claude-opus-4-5-20251101',
        model_endpoint_type: 'openai',
        model_endpoint: 'http://litellm:4000',
        context_window: 200000,
        temperature: 0.7,
      },
    });

    console.log(`Agent ${agentState.id} configured with Claude Opus 4.5`);

    // Step 3: Attach tools to agent (tool_ids in create doesn't work with letta-free)
    // SDK signature: attach(toolID, {agent_id})
    for (const toolId of toolIds) {
      try {
        await client.agents.tools.attach(toolId, { agent_id: agentState.id });
      } catch (attachErr) {
        console.warn(`Failed to attach tool ${toolId}:`, attachErr);
      }
    }
    console.log(`Attached ${String(toolIds.length)} tools to agent`);

    agentId = agentState.id;
    return agentId;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Failed to create agent:', err);
    throw new Error(`Failed to create agent: ${errorMessage}`);
  }
}

/**
 * Send a message to a Letta agent and get the response
 *
 * @param agentId - Letta agent ID
 * @param message - User message text
 * @returns Agent response text
 */
async function sendMessageToAgent(agentId: string, message: string): Promise<string> {
  const client = getLettaClient();

  try {
    const msgPreview = message.slice(0, 100) + (message.length > 100 ? '...' : '');
    console.log(`\n📤 Sending message to agent ${agentId}: "${msgPreview}"`);

    // Inject current date/time so the assistant has a sense of time
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    const messageWithTime = `[${timestamp}]\n${message}`;

    // Send message to agent (non-streaming mode for simplicity in M1)
    const response = await client.agents.messages.create(agentId, {
      input: messageWithTime,
      streaming: false,
    });

    // Log all messages in the response for debugging
    console.log(`📨 Agent response contains ${String(response.messages.length)} messages:`);
    for (const msg of response.messages) {
      const msgType = msg.message_type;
      if (msgType === 'tool_call_message') {
        // Tool call - show tool name and args
        const toolMsg = msg as { tool_call?: { name?: string; arguments?: string } };
        const toolName = toolMsg.tool_call?.name ?? 'unknown';
        const toolArgs = toolMsg.tool_call?.arguments ?? '{}';
        console.log(`   🔧 TOOL CALL: ${toolName}(${toolArgs})`);
      } else if (msgType === 'tool_return_message') {
        // Tool return - show result
        const returnMsg = msg as { tool_return?: string; status?: string };
        const status = returnMsg.status ?? 'unknown';
        const result = returnMsg.tool_return ?? '';
        const truncated = result.length > 200 ? result.slice(0, 200) + '...' : result;
        console.log(`   ✅ TOOL RETURN (${status}): ${truncated}`);
      } else if (msgType === 'assistant_message') {
        // Assistant message - show content preview
        const assistantMsg = msg as { content?: string | unknown[] };
        const content = typeof assistantMsg.content === 'string' ? assistantMsg.content : '[complex content]';
        const truncated = content.length > 100 ? content.slice(0, 100) + '...' : content;
        console.log(`   💬 ASSISTANT: ${truncated}`);
      } else if (msgType === 'reasoning_message') {
        // Reasoning/thinking
        const reasoningMsg = msg as { reasoning?: string };
        const reasoning = reasoningMsg.reasoning ?? '';
        const truncated = reasoning.length > 100 ? reasoning.slice(0, 100) + '...' : reasoning;
        console.log(`   🧠 REASONING: ${truncated}`);
      } else {
        console.log(`   📝 ${String(msgType)}`);
      }
    }

    // Extract the assistant's response from the messages
    // The response contains an array of messages, we want the assistant's reply
    const assistantMessages = response.messages.filter((msg) => msg.message_type === 'assistant_message');

    if (assistantMessages.length === 0) {
      console.warn('No assistant message in response:', response);
      return "I'm sorry, I didn't generate a response. Please try again.";
    }

    // Get the last assistant message
    const lastMessage = assistantMessages[assistantMessages.length - 1];

    // Check if lastMessage exists
    if (!lastMessage) {
      console.warn('No assistant message found in response:', response);
      return "I'm sorry, I didn't generate a response. Please try again.";
    }

    // Type guard to check if message is AssistantMessage
    if (lastMessage.message_type !== 'assistant_message') {
      console.warn('Last message is not an assistant message:', lastMessage);
      return "I'm sorry, I received an unexpected response format.";
    }

    // Now TypeScript knows lastMessage is AssistantMessage, which has content
    // Extract text content from the message
    // AssistantMessage has a 'content' field which can be a string or array
    if (typeof lastMessage.content === 'string') {
      return lastMessage.content;
    }

    // If content is an array, join text parts
    if (Array.isArray(lastMessage.content)) {
      interface TextPart {
        type: string;
        text: string;
      }

      const isTextPart = (part: unknown): part is TextPart => {
        return typeof part === 'object' && part !== null && 'type' in part && 'text' in part && part.type === 'text';
      };

      const textParts = lastMessage.content.filter(isTextPart).map((part) => part.text);
      const joinedText = textParts.join('\n');
      return joinedText !== '' ? joinedText : "I'm sorry, I couldn't process that message.";
    }

    console.warn('Unexpected message format:', lastMessage);
    return "I'm sorry, I received an unexpected response format.";
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Failed to send message to agent ${agentId}:`, err);
    throw new Error(`Failed to get response from agent: ${errorMessage}`);
  }
}

/**
 * Handle /start command
 */
bot.command('start', async (ctx: Context) => {
  const welcomeMessage = `Welcome to the ADHD Support Agent!

I'm here to help you with:
- Task management and breaking down complex tasks
- Time management and scheduling
- Reducing overwhelm and executive dysfunction
- Building habits and routines
- Managing distractions

Just send me a message and I'll do my best to help!

Use /help to see available commands.`;

  await ctx.reply(welcomeMessage);
});

/**
 * Handle /help command
 */
bot.command('help', async (ctx: Context) => {
  const helpMessage = `Available commands:

/start - Show welcome message
/help - Show this help message

Just send me a regular message to chat! I'll remember our conversation and help you with ADHD-related challenges.`;

  await ctx.reply(helpMessage);
});

/**
 * Handle /reset command - delete and recreate the agent
 */
bot.command('reset', async (ctx: Context) => {
  try {
    await ctx.sendChatAction('typing');

    const client = getLettaClient();

    if (agentId !== null) {
      console.log(`Deleting agent ${agentId}...`);
      await client.agents.delete(agentId);
      agentId = null;
      console.log('Agent deleted');
    }

    // Create fresh agent
    const newAgentId = await getOrCreateAgent();
    await ctx.reply(`Agent reset successfully. New agent ID: ${newAgentId.slice(0, 12)}...`);
  } catch (err: unknown) {
    console.error('Error resetting agent:', err);
    await ctx.reply('Failed to reset agent. Check logs for details.');
  }
});

/**
 * Handle text messages
 */
bot.on('message', async (ctx: Context) => {
  // Only handle text messages (ignore photos, videos, etc. for M1)
  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const messageText = ctx.message.text;

  // Skip if it's a command (already handled by command handlers)
  if (messageText.startsWith('/')) {
    return;
  }

  // Get user ID for detection (needed to save parsed items)
  const userId = ctx.from?.id ?? null;

  try {
    // Show typing indicator while processing
    await ctx.sendChatAction('typing');

    // Run Haiku-based detection for overwhelm, brain dumps, self-bullying
    const detection = await detectAndParse(messageText, userId);

    // Format detection context to prepend to message for Opus
    const detectionContext = formatDetectionContext(detection);

    // Get or create the single agent
    const currentAgentId = await getOrCreateAgent();

    // Send message to agent with detection context
    const messageForAgent = detectionContext + messageText;
    const response = await sendMessageToAgent(currentAgentId, messageForAgent);

    // Reply to user with Markdown formatting (fallback to plain text if parsing fails)
    try {
      await ctx.reply(response, { parse_mode: 'Markdown' });
    } catch {
      // Markdown parsing failed, send as plain text
      await ctx.reply(response);
    }
  } catch (err: unknown) {
    console.error('Error handling message:', err);

    // Send user-friendly error message
    const errorMessage = "I'm sorry, I encountered an error processing your message. Please try again later.";

    await ctx.reply(errorMessage).catch((replyError: unknown) => {
      console.error('Failed to send error message to user:', replyError);
    });
  }
});

/**
 * Export function to handle Telegram updates (for webhook mode)
 *
 * @param update - Telegram Update object
 */
export async function handleUpdate(update: Update): Promise<void> {
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    console.error('Error in handleUpdate:', error);
    throw error;
  }
}

/**
 * Register bot commands with Telegram
 *
 * Sets the command menu that appears in the Telegram UI.
 * Called on startup to keep BotFather commands in sync with code.
 *
 * TODO: Add command handlers for /dump, /focus, /wins when those features are ready:
 *   - /dump - Brain dump mode (capture unstructured thoughts)
 *   - /focus - Set current focus task
 *   - /wins - Show recent tiny wins
 */
export async function registerCommands(): Promise<void> {
  const commands = [
    { command: 'start', description: 'Start the bot' },
    { command: 'help', description: 'Show help' },
    { command: 'reset', description: 'Reset conversation (delete agent memory)' },
  ];

  await bot.telegram.setMyCommands(commands);
  console.log(`Registered ${String(commands.length)} bot commands with Telegram`);
}

/**
 * Register webhook with Telegram
 *
 * Called on startup when webhook mode is enabled.
 * Ensures the webhook is properly configured with the secret token.
 */
export async function registerWebhook(): Promise<void> {
  console.log(`Registering webhook: ${config.TELEGRAM_WEBHOOK_URL}`);

  await bot.telegram.setWebhook(config.TELEGRAM_WEBHOOK_URL, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
  });

  // Verify registration
  const info = await bot.telegram.getWebhookInfo();
  console.log(`Webhook registered: ${info.url ?? '(no url)'}`);

  if (info.last_error_message !== undefined && info.last_error_message !== '') {
    console.warn(`Webhook last error: ${info.last_error_message}`);
  }
}

/**
 * Start polling mode (for development)
 *
 * Only used when TELEGRAM_WEBHOOK_URL is empty.
 * Should NOT be called in production webhook mode.
 */
export async function startPolling(): Promise<void> {
  console.log('Starting Telegram bot in polling mode...');

  try {
    await bot.launch();
    console.log('Bot is running in polling mode');

    // Enable graceful stop
    process.once('SIGINT', () => {
      console.log('SIGINT received, stopping bot...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('SIGTERM received, stopping bot...');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    console.error('Failed to start polling:', error);
    throw error;
  }
}

// Handle Bun hot reload - stop bot before module replacement
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- import.meta.hot is undefined when not in hot mode
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    console.log('Hot reload: stopping bot...');
    bot.stop('HOT_RELOAD');
    // bot.stop() is sync but Telegram needs time to release the connection
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('Hot reload: bot stopped');
  });
}
