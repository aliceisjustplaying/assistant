# ADHD Support Agent

A Telegram bot that helps with ADHD task management, brain dumps, and gentle accountability. Built with Bun, Letta, and Claude.

## Architecture

```
Telegram → Bun Adapter → Letta Agent → Anthropic (via proxy)
```

- **Bun**: Runtime and HTTP server
- **Letta**: AI agent framework with persistent memory
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
- `anthropic-proxy` on port 4001
- `letta` on port 8283

The dev override (`docker-compose.dev.yml`) excludes the app service so you can run it locally.

### 4. Complete Anthropic OAuth

The anthropic-proxy requires OAuth setup for Anthropic API access:

1. Open http://localhost:4001 in your browser
2. Complete the Anthropic OAuth flow
3. Copy the session ID from the callback
4. Add it to your `.env`:
   ```
   ANTHROPIC_PROXY_SESSION_ID=your_session_id_here
   ```

### 5. Run the app

```bash
bun run src/index.ts
```

Or with hot reload:

```bash
bun --hot src/index.ts
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
│   ├── config.ts      # Environment configuration
│   ├── health.ts      # Health check endpoints
│   ├── letta.ts       # Letta client bootstrap
│   ├── index.ts       # Main server (M1)
│   ├── bot.ts         # Telegram bot (M1)
│   ├── db/            # Database schema (M2)
│   └── tools/         # Agent tools (M2+)
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile.anthropic-proxy
└── .env.example
```

## Milestones

- [x] **M0**: Infrastructure (Docker, config, health, Letta client)
- [ ] **M1**: E2E Chat (Telegram bot, basic message flow)
- [ ] **M2**: Tools + Items (database, capture, breakdown)
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

### Can't connect to Telegram

1. Verify bot token is correct
2. Check if another instance is running (only one can poll at a time)
3. For webhooks, ensure URL is publicly accessible with valid HTTPS
