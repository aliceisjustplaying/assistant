# Infrastructure Scripts

Single-command deployment to Hetzner Cloud with automatic DNS, SSL, and Tailscale setup.

## Quick Start

```bash
# Copy and fill in secrets
cp secrets.env.example secrets.env
nano secrets.env

# Deploy
./deploy.sh

# Complete Anthropic OAuth (URL shown in deploy output)
# Then restart services
```

## Prerequisites

### Hetzner Cloud
- Install CLI: `brew install hcloud`
- Create API token: https://console.hetzner.cloud → Security → API Tokens
- Configure: `hcloud context create assistant` (enter token when prompted)

### Cloudflare
- Create API token: https://dash.cloudflare.com/profile/api-tokens
  - Use "Edit zone DNS" template, scope to your zone
- Get Zone ID:
  - Go to https://dash.cloudflare.com
  - Click your domain
  - Right sidebar → scroll to **API** section
  - Copy the **Zone ID** (32-char hex string)

### Tailscale

Add tag to ACL policy (https://login.tailscale.com/admin/acls):
```json
{
  "tagOwners": {
    "tag:server": ["your-email@example.com", "tag:server"]
  }
}
```

Create OAuth client:
- Go to https://login.tailscale.com/admin/settings/oauth
- Scopes: `auth_keys` (write)
- Tags: `tag:server`
- Save client secret (shown only once)

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Full deployment: server, DNS, services |
| `teardown.sh` | Delete server and DNS records |
| `sync-prompt.sh` | Quick-sync system prompt without redeploy |

## After Deployment

### Complete Anthropic OAuth

The deploy script outputs a URL like:
```
http://100.x.x.x:4001/auth/device
```

Open this from any device on your Tailscale network, complete the OAuth flow, then:

```bash
ssh root@SERVER_IP
nano /opt/assistant/.env
# Set ANTHROPIC_PROXY_SESSION_ID=your_session_id
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

### GitHub Actions

The deploy script outputs:
- Deploy key (add to GitHub repo → Settings → Deploy keys)
- SSH private key (add to GitHub → Settings → Secrets → `SSH_KEY`)
- Server IP (add to GitHub → Settings → Secrets → `HOST`)

## Service Access

| Service | Access |
|---------|--------|
| App | `https://assistant.yourdomain.com` (public) |
| Letta | `http://TAILSCALE_IP:8283` (Tailscale only) |
| Netdata | `http://TAILSCALE_IP:19999` (Tailscale only) |
| Anthropic Proxy | `http://TAILSCALE_IP:4001` (Tailscale only) |

## Updating System Prompt

Edit `prompts/SYSTEM_PROMPT.md` locally, then:

```bash
./infra/sync-prompt.sh
```

This uploads the prompt and restarts only the app container (fast, no rebuild).
