# Deploying to Hetzner CX33 with Coolify

Complete guide to deploy the ADHD Support Agent on a Hetzner CX33 VPS using Coolify.

## Prerequisites

- Hetzner Cloud account
- Domain name (for HTTPS/webhooks)
- GitHub account (repo must be accessible)
- Telegram bot token (from @BotFather)
- OpenAI API key (for embeddings)

---

## Step 1: Create Hetzner VPS

1. Go to [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Create new project or select existing
3. Click **Add Server**
4. Configure:
   - **Location**: Falkenstein or Nuremberg (Germany) - cheapest
   - **Image**: Debian 13
   - **Type**: CX33 (4 vCPU, 8GB RAM, 80GB) - €5.49/mo
   - **Networking**: Public IPv4 (default)
   - **SSH Key**: Add your public key
   - **Name**: `assistant` or similar
5. Click **Create & Buy Now**
6. Note the IP address

---

## Step 2: Point Domain to Server

Add DNS records for your domain:

```
Type  Name              Value           TTL
A     assistant         YOUR_SERVER_IP  300
A     *.assistant       YOUR_SERVER_IP  300
```

Example: `assistant.yourdomain.com` → `YOUR_SERVER_IP`

Wait 5-10 minutes for DNS propagation.

---

## Step 3: Initial Server Setup

SSH into your server:

```bash
ssh root@YOUR_SERVER_IP
```

Run initial setup:

```bash
# Update system
apt update && apt upgrade -y

# Set timezone (optional)
timedatectl set-timezone UTC

# Reboot to apply kernel updates
reboot
```

### Firewall (Optional)

Use **Hetzner Cloud Firewall** instead of host-based firewalls:

1. In Hetzner Console → **Firewalls** → **Create Firewall**
2. Add inbound rules:
   - TCP 22 (SSH)
   - TCP 80 (HTTP - for Let's Encrypt)
   - TCP 443 (HTTPS)
   - TCP 8000 (Coolify UI - remove after setup)
3. Apply to your server

This is cleaner than ufw/iptables, which Docker often bypasses anyway.

---

## Step 4: Install Coolify

SSH back in after reboot:

```bash
ssh root@YOUR_SERVER_IP
```

Install Coolify:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This takes 2-5 minutes. When done, you'll see:

```
Coolify is now running!
Access it at: http://YOUR_IP:8000
```

---

## Step 5: Configure Coolify

1. Open `http://YOUR_SERVER_IP:8000` in your browser
2. Create admin account (use a strong password)
3. Complete the setup wizard:
   - **Instance Settings**: Set your instance name
   - **SSH Key**: Coolify generates one automatically

### Connect GitHub

1. Go to **Sources** → **Add New**
2. Select **GitHub App** (recommended) or **Deploy Key**
3. Follow the OAuth flow to connect your GitHub account
4. Grant access to your assistant repository

---

## Step 6: Create the Application Stack

Your app needs multiple services. In Coolify:

### 6.1 Create New Project

1. Go to **Projects** → **New Project**
2. Name: `assistant`

### 6.2 Add Docker Compose Resource

1. Inside the project, click **New Resource**
2. Select **Docker Compose**
3. Choose **Based on a Git Repository**
4. Select your repo and branch (`main` or `master`)
5. Coolify will detect `docker-compose.yml`

### 6.3 Configure Environment Variables

Go to **Environment Variables** and add:

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_PROXY_SESSION_SECRET=generate_a_32_char_random_string
OPENAI_API_KEY=sk-your-openai-key
TELEGRAM_WEBHOOK_SECRET_TOKEN=generate_another_random_string

# Set after first OAuth login (Step 8)
ANTHROPIC_PROXY_SESSION_ID=will_set_later

# Webhook URL (use your domain)
TELEGRAM_WEBHOOK_URL=https://assistant.yourdomain.com/webhook

# Tool webhook (internal Docker network)
TOOL_WEBHOOK_URL=http://app:3000
```

Generate random strings:
```bash
openssl rand -hex 32  # For SESSION_SECRET
openssl rand -hex 16  # For WEBHOOK_SECRET_TOKEN
```

### 6.4 Configure Domains

1. Go to the **app** service settings
2. Under **Domains**, add: `assistant.yourdomain.com`
3. Enable **HTTPS** (Coolify handles Let's Encrypt automatically)
4. Set port to `3000`

---

## Step 7: Deploy

1. Click **Deploy** in Coolify
2. Watch the build logs
3. First deploy takes 5-10 minutes (building Rust proxy, pulling images)
4. Subsequent deploys are much faster (cached layers)

### Verify Services

Once deployed, check health:

```bash
# From your local machine
curl https://assistant.yourdomain.com/health
```

Should return:
```json
{"status":"healthy","services":{"letta":"healthy","anthropic_proxy":"healthy"}}
```

---

## Step 8: Anthropic OAuth Setup

The anthropic-proxy needs a one-time OAuth login:

1. Open `http://YOUR_SERVER_IP:4001/login` in your browser
2. Log in with your Anthropic/Claude account
3. After successful login, you'll see a session ID
4. Copy the session ID
5. In Coolify, update the environment variable:
   ```
   ANTHROPIC_PROXY_SESSION_ID=your_session_id_here
   ```
6. Redeploy the stack

---

## Step 9: Set Telegram Webhook

```bash
# Set the webhook URL
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assistant.yourdomain.com/webhook",
    "secret_token": "YOUR_WEBHOOK_SECRET_TOKEN"
  }'

# Verify webhook is set
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

---

## Step 10: Test the Bot

1. Open Telegram
2. Find your bot (@YourBotName)
3. Send `/start` or any message
4. The bot should respond!

---

## Post-Deployment

### Secure Coolify UI

Once everything works, restrict Coolify UI access:

1. In Hetzner Console → **Firewalls** → Edit your firewall
2. Remove the TCP 8000 rule
3. Access Coolify through SSH tunnel instead:
   ```bash
   ssh -L 8000:localhost:8000 root@YOUR_SERVER_IP
   # Then open http://localhost:8000
   ```

### Enable Auto-Deploy

In Coolify, go to your resource and enable **Webhooks**:
- Push to your repo → automatic redeploy

### Monitor Resources

Coolify Dashboard shows:
- CPU/Memory usage per service
- Container logs
- Deployment history

### Backups

1. Go to **Servers** → Your server → **Backup**
2. Configure automatic backups for:
   - `letta-data` volume (PostgreSQL)
   - `./data` directory (SQLite)

---

## Troubleshooting

### Check Logs

In Coolify UI: Click any service → **Logs**

Or via SSH:
```bash
docker logs assistant-app-1 -f
docker logs assistant-letta-1 -f
docker logs assistant-litellm-1 -f
```

### Service Won't Start

```bash
# Check all containers
docker ps -a

# Check specific service logs
docker compose -f /path/to/compose logs letta
```

### Webhook Not Working

```bash
# Test webhook endpoint directly
curl -X POST https://assistant.yourdomain.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: YOUR_SECRET" \
  -d '{"update_id": 1}'
```

### Out of Memory

If services are crashing, check memory:
```bash
docker stats
free -h
```

CX33 has 8GB, which should be plenty. If issues persist, check for memory leaks in logs.

### Reset Everything

Nuclear option - start fresh:
```bash
cd /path/to/coolify/project
docker compose down -v  # Warning: deletes volumes!
docker compose up -d
```

---

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Hetzner CX33 | €5.49 |
| Domain (optional, if new) | ~€1/mo |
| Anthropic API | Usage-based |
| OpenAI API (embeddings) | ~$0.01/mo |
| **Total** | **~€6.50/mo + API usage** |

---

## Architecture Overview

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Hetzner CX33 (Debian 13 + Docker + Coolify)          │
│                                                     │
│  ┌─────────────┐      ┌─────────────────────────┐  │
│  │ Caddy/Nginx │◄────►│ app (Bun :3000)         │  │
│  │ (Coolify)   │      │ - Telegram webhook      │  │
│  │ :443 HTTPS  │      │ - Tool dispatcher       │  │
│  └─────────────┘      └──────────┬──────────────┘  │
│                                  │                  │
│                                  ▼                  │
│                       ┌─────────────────────────┐  │
│                       │ letta (:8283)           │  │
│                       │ - Agent orchestration   │  │
│                       │ - Memory (PostgreSQL)   │  │
│                       └──────────┬──────────────┘  │
│                                  │                  │
│                                  ▼                  │
│                       ┌─────────────────────────┐  │
│                       │ litellm (:4000)         │  │
│                       │ - OpenAI-compatible API │  │
│                       └──────────┬──────────────┘  │
│                                  │                  │
│                                  ▼                  │
│  ┌─────────────┐      ┌─────────────────────────┐  │
│  │auth-adapter │◄────►│ anthropic-proxy (:4001) │  │
│  │   (:4002)   │      │ - OAuth session mgmt    │  │
│  └─────────────┘      └──────────┬──────────────┘  │
│                                  │                  │
└──────────────────────────────────┼──────────────────┘
                                   │
                                   ▼
                          Anthropic API (Claude)
```
