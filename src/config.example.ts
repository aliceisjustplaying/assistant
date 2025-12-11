/**
 * Example usage of the config module
 *
 * This file demonstrates how to use the configuration in your application.
 * Run with: bun run src/config.example.ts
 */

import { config, validateConfig, isWebhookMode, isAnthropicProxyReady } from './config';

console.log('=== ADHD Support Agent Configuration ===\n');

// Validate configuration at startup
try {
  validateConfig();
  console.log('✅ Configuration is valid\n');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Configuration error:', message);
  process.exit(1);
}

// Display configuration
console.log('Server Configuration:');
console.log(`  PORT: ${config.PORT.toString()}`);
console.log(`  DB_PATH: ${config.DB_PATH}`);
console.log();

console.log('Letta Configuration:');
console.log(`  LETTA_BASE_URL: ${config.LETTA_BASE_URL}`);
console.log();

console.log('Telegram Configuration:');
console.log(`  TELEGRAM_BOT_TOKEN: ${config.TELEGRAM_BOT_TOKEN.slice(0, 10)}...`);
console.log(`  Mode: ${isWebhookMode() ? 'Webhook' : 'Polling'}`);
if (isWebhookMode()) {
  console.log(`  TELEGRAM_WEBHOOK_URL: ${config.TELEGRAM_WEBHOOK_URL}`);
}
console.log();

console.log('Anthropic Proxy Configuration:');
console.log(`  ANTHROPIC_PROXY_URL: ${config.ANTHROPIC_PROXY_URL}`);
console.log(`  Status: ${isAnthropicProxyReady() ? 'Ready' : 'Needs OAuth setup'}`);
console.log();

console.log('OpenAI Configuration:');
console.log(`  OPENAI_API_KEY: ${config.OPENAI_API_KEY.slice(0, 10)}...`);
console.log();

// Example: Conditional logic based on configuration
if (!isAnthropicProxyReady()) {
  console.warn('⚠️  Warning: Anthropic proxy is not configured.');
  console.warn('   Please complete OAuth flow to set ANTHROPIC_PROXY_SESSION_ID');
}

if (!isWebhookMode()) {
  console.warn('⚠️  Warning: Running in polling mode (development only).');
  console.warn('   Set TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET_TOKEN for production.');
}
