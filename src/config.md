# Configuration Module

The `config.ts` module handles environment variable parsing and validation for the ADHD Support Agent.

## Usage

```typescript
import { config, validateConfig, isWebhookMode, isAnthropicProxyReady } from "./config";

// Access config values
console.log(`Server running on port ${config.PORT}`);
console.log(`Letta URL: ${config.LETTA_BASE_URL}`);

// Validate configuration at startup
validateConfig(); // Throws if configuration is invalid

// Check mode
if (isWebhookMode()) {
  console.log("Running in webhook mode");
} else {
  console.log("Running in polling mode (dev only)");
}

// Check if Anthropic proxy is ready
if (isAnthropicProxyReady()) {
  console.log("Anthropic proxy is configured");
} else {
  console.warn("Anthropic proxy needs OAuth setup");
}
```

## Environment Variables

### Required Variables

These must be set or the application will fail to start:

- `LETTA_BASE_URL` - Base URL for Letta API (e.g., `http://letta:8283`)
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `ANTHROPIC_PROXY_URL` - Base URL for anthropic-proxy (e.g., `http://anthropic-proxy:4001/v1`)
- `ANTHROPIC_PROXY_SESSION_SECRET` - Random 32-char string for session encryption
- `OPENAI_API_KEY` - OpenAI API key (used for embeddings only)

### Optional Variables

These have sensible defaults:

- `PORT` - Server port (default: `3000`)
- `TELEGRAM_WEBHOOK_URL` - Webhook URL for production (default: empty = polling mode)
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` - Secret token for webhook verification (default: empty)
- `ANTHROPIC_PROXY_SESSION_ID` - Session ID from OAuth flow (default: empty = needs setup)
- `DB_PATH` - Path to SQLite database (default: `./data/assistant.db`)

## Configuration Validation

The `validateConfig()` function performs additional validation:

1. **URL validation** - Ensures all URLs are properly formatted
2. **PORT validation** - Ensures port is in range 1-65535
3. **Webhook consistency** - Both `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET_TOKEN` must be set together
4. **Session ID warning** - Warns if `ANTHROPIC_PROXY_SESSION_ID` is not set

## Helper Functions

### `isWebhookMode(): boolean`

Returns `true` if both webhook URL and secret token are configured. When `false`, the bot should run in polling mode (development only).

### `isAnthropicProxyReady(): boolean`

Returns `true` if the Anthropic proxy session ID is configured. When `false`, the OAuth flow needs to be completed before the proxy can be used.

## Development vs Production

### Development (local)

```env
LETTA_BASE_URL=http://localhost:8283
ANTHROPIC_PROXY_URL=http://localhost:4001/v1
# Leave webhook vars empty for polling mode
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET_TOKEN=
```

### Production (Docker)

```env
LETTA_BASE_URL=http://letta:8283
ANTHROPIC_PROXY_URL=http://anthropic-proxy:4001/v1
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=your-random-secret
```

## Error Handling

The config module throws clear errors when:

- Required environment variables are missing
- URLs are malformed
- PORT is out of range
- Numbers can't be parsed

All errors include the variable name and the problematic value to make debugging easy.

## Testing

Run tests with:

```bash
bun test src/config.test.ts
```

The test suite validates:
- URL parsing
- Port validation
- Webhook mode detection
- Session ID detection
- Number parsing
- Default values
