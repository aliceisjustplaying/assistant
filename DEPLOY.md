# Deploying to Hetzner VPS

Simple deployment using Docker Compose + Caddy + GitHub Actions.

## Prerequisites

- Hetzner Cloud account
- Domain name (for HTTPS)
- GitHub repo access
- Telegram bot token (from @BotFather)
- OpenAI API key (for embeddings)

---

## Create Hetzner VPS

1. Go to [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Create new project or select existing
3. Click **Add Server**
4. Configure:
   - **Location**: Falkenstein or Nuremberg (cheapest)
   - **Image**: Debian 13
   - **Type**: CX33 (4 vCPU, 8GB RAM) - €5.49/mo
   - **SSH Key**: Add your public key
   - **Name**: `assistant`
5. Click **Create & Buy Now**
6. Note the IP address

### Firewall (Optional)

In Hetzner Console → **Firewalls** → **Create Firewall**:
- TCP 22 (SSH)
- TCP 80 (HTTP - for Let's Encrypt)
- TCP 443 (HTTPS)

Apply to your server.

---

## Point Domain to Server

Add DNS A record:
```
assistant.yourdomain.com → YOUR_SERVER_IP
```

Wait 5-10 minutes for propagation.

---

## Server Setup

SSH in:
```bash
ssh root@YOUR_SERVER_IP
```

Update system:
```bash
apt update && apt upgrade -y
```

Install Docker:
```bash
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Install mosh and git:
```bash
apt install -y mosh git
```

Install Tailscale (for secure access to internal services):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Follow the link to authenticate with your Tailscale account. Note your server's Tailscale IP (100.x.x.x).

Install GitHub CLI:
```bash
(type -p wget >/dev/null || (apt update && apt install wget -y)) && mkdir -p -m 755 /etc/apt/keyrings && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg && cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt update && apt install gh -y
```

Authenticate with GitHub:
```bash
gh auth login
```

Clone the repo:
```bash
mkdir -p /opt
cd /opt
gh repo clone YOUR_USERNAME/assistant
cd assistant
```

---

## Configure Environment

Copy the example and customize:
```bash
cp .env.example .env
vim .env
```

Generate random strings for secrets:
```bash
openssl rand -hex 32  # For ANTHROPIC_PROXY_SESSION_SECRET
openssl rand -hex 16  # For TELEGRAM_WEBHOOK_SECRET_TOKEN
```

Key values to set:
- `TELEGRAM_BOT_TOKEN` - from @BotFather
- `TELEGRAM_WEBHOOK_URL` - `https://assistant.yourdomain.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` - generated above
- `ANTHROPIC_PROXY_SESSION_SECRET` - generated above
- `OPENAI_API_KEY` - your OpenAI key

---

## Configure Caddy

Copy the example and customize:
```bash
cp Caddyfile.example Caddyfile
vim Caddyfile
```

Replace the example domains with your actual domains.

---

## Deploy

Start all services (production compose file is included in the repo):
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Check status:
```bash
docker compose ps
docker compose logs -f app
```

---

## Anthropic OAuth

Complete one-time OAuth setup:

1. Open SSH tunnel to access the proxy:
   ```bash
   # From your local machine
   ssh -L 4001:localhost:4001 root@YOUR_SERVER_IP
   ```

2. Open http://localhost:4001/auth/device in your browser

3. Complete the OAuth flow

4. Copy the session ID and update `.env`:
   ```bash
   # On server
   nano /opt/assistant/.env
   # Set ANTHROPIC_PROXY_SESSION_ID=your_session_id
   ```

5. Restart:
   ```bash
   cd /opt/assistant
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

---

## Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://assistant.yourdomain.com/webhook",
    "secret_token": "YOUR_WEBHOOK_SECRET_TOKEN"
  }'
```

Verify:
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

---

## Setup Auto-Deploy

### On Server: Make deploy script executable

The `deploy.sh` script is included in the repo. Just make it executable:
```bash
chmod +x /opt/assistant/deploy.sh
```

### On Server: Add deploy SSH key

```bash
# Generate deploy key (no passphrase)
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
# Add this to GitHub repo: Settings → Deploy keys (read-only is fine)
```

```bash
cat ~/.ssh/deploy_key
# Copy the PRIVATE key for GitHub Actions secret
```

### On GitHub: Add secrets

Go to repo **Settings → Secrets and variables → Actions**, add:
- `HOST`: Your server IP
- `SSH_KEY`: The private key from above

The workflow file (`.github/workflows/deploy.yml`) is already in the repo.

Now every push to `main` triggers automatic deployment.

---

## Verify

Test the bot:
1. Open Telegram
2. Message your bot
3. Should respond!

Check health:
```bash
curl https://assistant.yourdomain.com/health
```

---

## Monitoring

Netdata is included for real-time monitoring, accessible via Tailscale.

### Access Netdata

From any device on your Tailscale network, open:
```
http://YOUR_TAILSCALE_IP:19999
```

Or use the Tailscale hostname:
```
http://assistant:19999
```

### What you get

- CPU, RAM, disk, network graphs (1-second resolution)
- Per-container Docker metrics (CPU, memory, I/O)
- ~2 weeks retention by default

### Optional: Netdata Cloud

For alerts and multi-server dashboards:

- Sign up at https://app.netdata.cloud
- Get your claim token
- Add `NETDATA_CLAIM_TOKEN=your_token` to `.env`
- Restart: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

---

## Maintenance

### View logs
```bash
cd /opt/assistant
docker compose logs -f           # All services
docker compose logs -f app       # Just the bot
docker compose logs -f letta     # Just Letta
```

### Restart services
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

### Manual deploy
```bash
/opt/assistant/deploy.sh
```

### Update SSL cert (automatic)
Caddy handles Let's Encrypt automatically. No action needed.

### Backup data
```bash
# SQLite database
cp /opt/assistant/data/assistant.db ~/backup/

# Letta PostgreSQL (if needed)
docker compose exec letta pg_dump -U letta letta > ~/backup/letta.sql
```

---

## Troubleshooting

### Container won't start
```bash
docker compose logs <service>
docker compose ps -a
```

### SSL not working
```bash
docker compose logs caddy
# Ensure ports 80/443 are open in Hetzner firewall
# Ensure DNS is pointing to your server
```

### Webhook not receiving
```bash
# Test manually
curl -X POST https://assistant.yourdomain.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: YOUR_SECRET" \
  -d '{"update_id": 1}'
```

### Out of memory
```bash
docker stats
free -h
# CX33 has 8GB, should be plenty
```

---

## Cost

| Item | Monthly |
|------|---------|
| Hetzner CX33 | €5.49 |
| Domain | ~€1 |
| APIs | Usage-based |
| **Total** | **~€6.50 + API** |

---

## Architecture

```
Internet                              Tailscale Network
    │                                        │
    ▼                                        ▼
┌────────────────────────────────────────────────────────────┐
│ Hetzner CX33 (Debian 13 + Docker + Tailscale)              │
│                                                            │
│  ┌──────────────────────────────────────┐                  │
│  │ Caddy (:80/:443) - auto-SSL          │                  │
│  │  ├─► app:3000      (assistant.*)     │                  │
│  │  └─► letta:8283    (letta.*)         │                  │
│  └──────────────────────────────────────┘                  │
│                    │                                       │
│                    ▼                                       │
│          ┌──────────────────┐   ┌───────────────────────┐  │
│          │ app (Bun :3000)  │   │ netdata (:19999)      │  │
│          │ Telegram webhook │   │ via Tailscale only    │  │
│          └────────┬─────────┘   └───────────────────────┘  │
│                   │                                        │
│                   ▼                                        │
│          ┌──────────────────┐                              │
│          │ letta (:8283)    │                              │
│          │ Agent + Memory   │                              │
│          └────────┬─────────┘                              │
│                   │                                        │
│                   ▼                                        │
│          ┌──────────────────┐                              │
│          │ litellm (:4000)  │                              │
│          └────────┬─────────┘                              │
│                   │                                        │
│                   ▼                                        │
│          ┌──────────────────┐                              │
│          │ auth-adapter     │                              │
│          │ (:4002) headers  │                              │
│          └────────┬─────────┘                              │
│                   │                                        │
│                   ▼                                        │
│          ┌──────────────────┐                              │
│          │ anthropic-proxy  │                              │
│          │ (:4001) OAuth    │                              │
│          └────────┬─────────┘                              │
└───────────────────┼────────────────────────────────────────┘
                    │
                    ▼
             Anthropic API
```
