# ADHD Support Agent

A Telegram bot that helps with ADHD task management, brain dumps, and gentle accountability. Built with Bun, Letta, and Claude.

## Architecture

```
Telegram Bot (Bun)
       ↓
Letta (port 8283) - AI agent framework
       ↓ OpenAI-compatible API
LiteLLM (port 4000) - API translation layer
       ↓ Anthropic API format
auth-adapter (port 4002) - Header translation
       ↓
anthropic-proxy (port 4001) - OAuth session management
       ↓
Anthropic API (Claude Opus 4.5)
```

- **Bun**: Runtime and HTTP server for Telegram bot
- **Letta**: AI agent framework with persistent memory
- **LiteLLM**: Translates OpenAI-compatible requests to Anthropic format
- **auth-adapter**: Middleware for header translation (Bearer → x-api-key)
- **anthropic-proxy**: OAuth proxy for Anthropic API access
- **SQLite**: Local storage for items, wins, and context

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Telegram account (for bot setup)
- OpenAI API key (for embeddings)
- Anthropic account (for Claude access via OAuth)

## Development Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see sections below for how to get each).

### 3. Start Docker services

Start the anthropic-proxy and Letta services:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This starts:
- `anthropic-proxy` on port 4001 - OAuth proxy for Anthropic API
- `auth-adapter` on port 4002 - Header translation middleware
- `litellm` on port 4000 - OpenAI-compatible API proxy
- `letta` on port 8283 - AI agent framework

The dev override (`docker-compose.dev.yml`) excludes the app service so you can run it locally.

### 4. Complete Anthropic OAuth

The anthropic-proxy requires OAuth setup for Anthropic API access:

1. Open http://localhost:4001/auth/device in your browser
2. Click "Start Authorization" to generate an auth URL
3. Open the URL and authorize in Claude
4. Paste the authorization code back into the form
5. Copy the session ID shown after success
6. Add it to your `.env`:
   ```
   ANTHROPIC_PROXY_SESSION_ID=your_session_id_here
   ```

### 5. Verify Letta setup

Verify that Letta can access Claude models via LiteLLM:

```bash
bun run setup:letta
```

This checks that the proxy chain is working and Claude models are available.

### 6. Run the app

```bash
bun run dev
```

Or without hot reload:

```bash
bun run start
```

## Environment Variables

### Required

| Variable | Description | How to get |
|----------|-------------|------------|
| `TELEGRAM_BOT_TOKEN` | Bot token | Create bot via [@BotFather](https://t.me/BotFather) |
| `LETTA_BASE_URL` | Letta API URL | `http://localhost:8283` for dev |
| `ANTHROPIC_PROXY_URL` | Proxy URL | `http://localhost:4001/v1` for dev |
| `ANTHROPIC_PROXY_SESSION_SECRET` | Proxy secret | Generate: `openssl rand -hex 32` |
| `OPENAI_API_KEY` | OpenAI key | [platform.openai.com](https://platform.openai.com/api-keys) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `TELEGRAM_WEBHOOK_URL` | (empty) | Webhook URL for production |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | (empty) | Webhook verification secret |
| `ANTHROPIC_PROXY_SESSION_ID` | (empty) | Filled after OAuth flow |
| `DB_PATH` | `./data/assistant.db` | SQLite database path |

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token to `TELEGRAM_BOT_TOKEN` in `.env`
4. (Optional) Set bot commands via `/setcommands`:
   ```
start - Start the bot
help - Show help
dump - Brain dump mode
focus - Set current focus
wins - Show recent wins
   ```

### Webhook vs Polling

**Development (polling):** Leave `TELEGRAM_WEBHOOK_URL` empty. The bot will poll for updates.

**Production (webhook):** Set both:
```
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=your_secret_here
```

## Docker Services

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f letta
docker compose logs -f anthropic-proxy
```

### Restart services

```bash
docker compose restart
```

### Stop services

```bash
docker compose down
```

### Rebuild (after Dockerfile changes)

```bash
docker compose build --no-cache anthropic-proxy
docker compose up -d
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/config.test.ts

# Watch mode
bun test --watch
```

## Project Structure

```
├── src/
│   ├── index.ts           # Main server entry point
│   ├── bot.ts             # Telegram bot handlers
│   ├── config.ts          # Environment configuration
│   ├── health.ts          # Health check endpoints
│   ├── letta.ts           # Letta client bootstrap
│   ├── auth-adapter.ts    # Header translation middleware
│   ├── db/
│   │   ├── index.ts       # Database initialization
│   │   ├── schema.ts      # Drizzle ORM schema
│   │   └── migrations/    # SQL migrations
│   └── tools/
│       ├── index.ts       # Barrel exports
│       ├── dispatcher.ts  # Tool registry and Letta integration
│       ├── capture.ts     # parse_brain_dump tool
│       ├── breakdown.ts   # break_down_task tool
│       ├── items.ts       # save_item, update_item tools
│       └── context.ts     # get_open_items tool
├── scripts/
│   └── setup-letta-provider.ts  # Setup verification
├── drizzle.config.ts      # Drizzle Kit configuration
├── litellm-config.yaml    # LiteLLM model configuration
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile.anthropic-proxy
└── .env.example
```

## Milestones

- [x] **M0**: Infrastructure (Docker, config, health, Letta client)
- [x] **M1**: E2E Chat (Telegram bot, basic message flow)
- [x] **M2**: Tools + Items (database, capture, breakdown)
- [ ] **M3**: Tone + Detection (overwhelm, self-bullying)
- [ ] **M4**: Tiny Wins (win tracking)
- [ ] **M5**: Threading (focus, deviations)
- [ ] **M6**: Hardening (idempotency, retries, tests)

## Troubleshooting

### "Missing required environment variable"

Make sure you've copied `.env.example` to `.env` and filled in all required values.

### Letta health check failing

Check if Letta is running:
```bash
curl http://localhost:8283/v1/health
```

If not responding, check logs:
```bash
docker compose logs letta
```

### Anthropic proxy not working

1. Verify the proxy is running: `curl http://localhost:4001/health`
2. Check if OAuth is complete (session ID should be set)
3. Check logs: `docker compose logs anthropic-proxy`

### LiteLLM not routing to Claude

1. Verify LiteLLM is running: `curl http://localhost:4000/health`
2. Check available models: `curl http://localhost:4000/models`
3. Test direct call: `curl -X POST http://localhost:4000/chat/completions -H "Content-Type: application/json" -d '{"model":"claude-opus-4-5-20251101","messages":[{"role":"user","content":"Hi"}],"max_tokens":10}'`
4. Check logs: `docker compose logs litellm`

### Can't connect to Telegram

1. Verify bot token is correct
2. Check if another instance is running (only one can poll at a time)
3. For webhooks, ensure URL is publicly accessible with valid HTTPS

### Tools not working / "missing required parameter"

This usually means Letta doesn't know the tool's parameter schema. Check:

1. **Verify tool schema in Letta:**
   ```bash
   curl http://localhost:8283/v1/tools/<tool-id> | jq '.json_schema'
   ```
   If `properties` is empty `{}`, the schema wasn't registered correctly.

2. **Restart the app** to re-register tools:
   ```bash
   # Kill and restart
   bun run dev
   ```
   Watch for "Updated tool 'xxx'" messages in the logs.

3. **Check tool webhook is receiving calls:**
   Look for `🔧 TOOL WEBHOOK RECEIVED:` in the console output.

4. **Delete and recreate the agent** if tools were registered after agent creation:
   ```bash
   # List agents
   curl http://localhost:8283/v1/agents | jq '.[].id'
   # Delete problematic agent
   curl -X DELETE http://localhost:8283/v1/agents/<agent-id>
   ```
   The bot will create a new agent on the next message.

See `AGENTS.md` for detailed Letta tool registration requirements.
