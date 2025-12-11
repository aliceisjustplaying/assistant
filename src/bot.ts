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
import { getLettaClient } from './letta';

/**
 * Create Telegraf bot instance
 */
export const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

/**
 * In-memory map of Telegram user ID -> Letta agent ID
 * In production, this would be stored in a database
 */
const userAgentMap = new Map<number, string>();

/**
 * Get or create a Letta agent for the given Telegram user
 *
 * For M1, this is a simple implementation that creates one agent per user.
 * Later milestones will add more sophisticated agent management.
 *
 * @param userId - Telegram user ID
 * @param username - Telegram username (for logging/debugging)
 * @returns Agent ID
 */
async function getOrCreateAgentForUser(userId: number, username?: string): Promise<string> {
  // Check if we already have an agent for this user
  const existingAgentId = userAgentMap.get(userId);
  if (existingAgentId !== undefined) {
    console.log(`Using existing agent ${existingAgentId} for user ${userId.toString()}`);
    return existingAgentId;
  }

  // Create a new agent for this user
  const client = getLettaClient();

  try {
    const usernameOrUnknown = username ?? 'unknown';
    console.log(`Creating new agent for user ${userId.toString()} (${usernameOrUnknown})`);

    // Create agent with basic configuration
    // For M1, we'll use a simple configuration. Later milestones will customize this.
    // Note: The model string should be in the format "provider/model-name"
    // The Letta server should be configured with the anthropic-proxy as a provider
    const agentState = await client.agents.create({
      name: `user-${userId.toString()}-${usernameOrUnknown}`,
      description: `ADHD support agent for Telegram user ${userId.toString()}`,
      // Using Claude Opus 4.5 via claude-proxy provider
      model: 'claude-proxy/claude-opus-4-5-20251101',
      embedding: 'openai/text-embedding-ada-002',
      // Memory blocks with system prompt for ADHD support
      memory_blocks: [
        {
          label: 'persona',
          value: `You are a helpful ADHD support assistant. You help users with:
- Task management and breaking down complex tasks
- Time management and scheduling
- Reducing overwhelm and executive dysfunction
- Building habits and routines
- Managing distractions

Be supportive, understanding, and practical. Keep responses concise and actionable.`,
        },
      ],
    });

    console.log(`Created agent ${agentState.id} for user ${userId.toString()}`);

    // Store the mapping
    userAgentMap.set(userId, agentState.id);

    return agentState.id;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Failed to create agent for user ${userId.toString()}:`, err);
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
    // Send message to agent (non-streaming mode for simplicity in M1)
    const response = await client.agents.messages.create(agentId, {
      input: message,
      streaming: false,
    });

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
 * Handle text messages
 */
bot.on('message', async (ctx: Context) => {
  // Only handle text messages (ignore photos, videos, etc. for M1)
  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const messageText = ctx.message.text;

  // Check if ctx.from exists (it should always exist for messages, but TypeScript requires the check)
  if (!ctx.from) {
    console.error('Message received without sender information');
    return;
  }

  const userId = ctx.from.id;
  const username = ctx.from.username;

  // Skip if it's a command (already handled by command handlers)
  if (messageText.startsWith('/')) {
    return;
  }

  try {
    // Show typing indicator while processing
    await ctx.sendChatAction('typing');

    // Get or create agent for this user
    const agentId = await getOrCreateAgentForUser(userId, username);

    // Send message to agent and get response
    const response = await sendMessageToAgent(agentId, messageText);

    // Reply to user
    await ctx.reply(response);
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
