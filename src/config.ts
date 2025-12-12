/**
 * Configuration module for ADHD Support Agent
 *
 * Parses and validates environment variables.
 * Bun automatically loads .env files, so no dotenv package needed.
 */

/**
 * Require an environment variable, throwing a clear error if missing
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value
 */
function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : defaultValue;
}

/**
 * Parse a number from an environment variable, with optional default
 */
function numberEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${value}`);
  }
  return parsed;
}

/**
 * Application configuration
 *
 * All environment variables are parsed and validated on module load.
 * Missing required variables will throw errors immediately.
 */
export const config = {
  // === Server ===
  PORT: numberEnv('PORT', 3000),

  // === Letta ===
  LETTA_BASE_URL: requireEnv('LETTA_BASE_URL'),

  // === Telegram ===
  TELEGRAM_BOT_TOKEN: requireEnv('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_WEBHOOK_URL: optionalEnv('TELEGRAM_WEBHOOK_URL', ''),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: optionalEnv('TELEGRAM_WEBHOOK_SECRET_TOKEN', ''),

  // === Anthropic Proxy ===
  ANTHROPIC_PROXY_URL: optionalEnv('ANTHROPIC_PROXY_URL', 'http://localhost:4001'),
  ANTHROPIC_PROXY_SESSION_SECRET: optionalEnv('ANTHROPIC_PROXY_SESSION_SECRET', ''),
  ANTHROPIC_PROXY_SESSION_ID: optionalEnv('ANTHROPIC_PROXY_SESSION_ID', ''),

  // === LiteLLM ===
  LITELLM_URL: optionalEnv('LITELLM_URL', 'http://localhost:4000'),

  // === Models ===
  HAIKU_MODEL: optionalEnv('HAIKU_MODEL', 'claude-haiku-4-5-20251001'),

  // === OpenAI (embeddings only) ===
  OPENAI_API_KEY: requireEnv('OPENAI_API_KEY'),

  // === Database ===
  DB_PATH: optionalEnv('DB_PATH', './data/assistant.db'),

  // === Tool Webhooks ===
  // URL for Letta's Python tool stubs to call back to our handlers
  // Use host.docker.internal on Mac/Windows, 172.17.0.1 on Linux
  TOOL_WEBHOOK_URL: optionalEnv('TOOL_WEBHOOK_URL', 'http://host.docker.internal:3000'),
} as const;

/**
 * Validate configuration at startup
 *
 * Performs additional validation beyond basic presence checks.
 * Call this after importing config to ensure everything is valid.
 */
export function validateConfig(): void {
  // Webhook URL and secret token must both be present or both be empty
  const hasWebhookUrl = config.TELEGRAM_WEBHOOK_URL !== '';
  const hasWebhookSecret = config.TELEGRAM_WEBHOOK_SECRET_TOKEN !== '';

  if (hasWebhookUrl !== hasWebhookSecret) {
    throw new Error(
      'TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET_TOKEN must both be set or both be empty. ' +
        'If both are empty, the bot will run in polling mode (dev only).'
    );
  }

  // Validate URLs
  try {
    new URL(config.LETTA_BASE_URL);
  } catch {
    throw new Error(`LETTA_BASE_URL must be a valid URL, got: ${config.LETTA_BASE_URL}`);
  }

  if (hasWebhookUrl) {
    try {
      new URL(config.TELEGRAM_WEBHOOK_URL);
    } catch {
      throw new Error(`TELEGRAM_WEBHOOK_URL must be a valid URL, got: ${config.TELEGRAM_WEBHOOK_URL}`);
    }
  }

  // Warn if session ID is missing (needed for anthropic-proxy OAuth to work)
  if (config.ANTHROPIC_PROXY_SESSION_ID === '') {
    console.warn(
      '⚠️  ANTHROPIC_PROXY_SESSION_ID is not set. ' + 'Complete OAuth flow at http://localhost:4001/auth/device'
    );
  }

  // Port validation
  if (config.PORT < 1 || config.PORT > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${config.PORT.toString()}`);
  }
}

/**
 * Determine if the bot should run in webhook mode or polling mode
 */
export function isWebhookMode(): boolean {
  return config.TELEGRAM_WEBHOOK_URL !== '' && config.TELEGRAM_WEBHOOK_SECRET_TOKEN !== '';
}

/**
 * Determine if the Anthropic proxy is configured and ready
 */
export function isAnthropicProxyReady(): boolean {
  return config.ANTHROPIC_PROXY_SESSION_ID !== '';
}
