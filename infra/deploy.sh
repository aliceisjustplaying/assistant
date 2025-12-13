#!/usr/bin/env bash
# Single-command deployment for assistant to Hetzner Cloud
#
# Prerequisites:
#   - hcloud CLI installed and configured (hcloud context create assistant)
#   - secrets.env filled in (cp secrets.env.example secrets.env)
#
# Usage:
#   ./deploy.sh

set -euo pipefail
IFS=$'\n\t'

# Safe temp directory with automatic cleanup
scratch=$(mktemp -d -t deploy.XXXXXXXXXX)
function finish {
  rm -rf "$scratch"
}
trap finish EXIT

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Server name
SERVER_NAME="assistant"

#######################################
# Logging functions
#######################################
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

die() {
  log_error "$1"
  exit 1
}

#######################################
# Check prerequisites
#######################################
check_prerequisites() {
  log_info "Checking prerequisites..."

  # Check required commands
  local missing=()
  for cmd in hcloud jq curl ssh scp; do
    if ! command -v "$cmd" &> /dev/null; then
      missing+=("$cmd")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing required commands: ${missing[*]}"
  fi

  # Check hcloud is configured
  if ! hcloud context active &> /dev/null; then
    die "hcloud not configured. Run: hcloud context create assistant"
  fi

  # Check secrets.env exists
  if [[ ! -f "$SCRIPT_DIR/secrets.env" ]]; then
    die "secrets.env not found. Run: cp secrets.env.example secrets.env"
  fi

  log_success "Prerequisites OK"
}

#######################################
# Load and validate secrets
#######################################
load_secrets() {
  log_info "Loading secrets..."

  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/secrets.env"

  # Required variables
  local required=(
    DOMAIN
    SUBDOMAIN
    CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ZONE_ID
    TS_OAUTH_SECRET
    TS_TAG
    GH_REPO
    TELEGRAM_BOT_TOKEN
    OPENAI_API_KEY
  )

  local missing=()
  for var in "${required[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("$var")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing required secrets: ${missing[*]}"
  fi

  # Generate optional secrets if empty
  if [[ -z "${ANTHROPIC_PROXY_SESSION_SECRET:-}" ]]; then
    ANTHROPIC_PROXY_SESSION_SECRET=$(openssl rand -hex 32)
    log_info "Generated ANTHROPIC_PROXY_SESSION_SECRET"
  fi

  if [[ -z "${TELEGRAM_WEBHOOK_SECRET_TOKEN:-}" ]]; then
    TELEGRAM_WEBHOOK_SECRET_TOKEN=$(openssl rand -hex 16)
    log_info "Generated TELEGRAM_WEBHOOK_SECRET_TOKEN"
  fi

  if [[ -z "${LETTA_SERVER_PASSWORD:-}" ]]; then
    LETTA_SERVER_PASSWORD=$(openssl rand -hex 16)
    log_info "Generated LETTA_SERVER_PASSWORD"
  fi

  # Defaults
  HETZNER_LOCATION="${HETZNER_LOCATION:-fsn1}"
  HETZNER_SERVER_TYPE="${HETZNER_SERVER_TYPE:-cx22}"

  log_success "Secrets loaded"
}

#######################################
# Create or get SSH key
#######################################
setup_ssh_key() {
  log_info "Setting up SSH key..."

  local key_name="assistant-deploy"

  # Check if key exists in hcloud
  if hcloud ssh-key describe "$key_name" &> /dev/null; then
    log_info "Using existing SSH key: $key_name"
    SSH_KEY_NAME="$key_name"
    return
  fi

  # Check if local key exists
  local local_key="$HOME/.ssh/id_ed25519"
  if [[ ! -f "$local_key" ]]; then
    local_key="$HOME/.ssh/id_rsa"
  fi

  if [[ ! -f "$local_key" ]]; then
    die "No SSH key found. Create one with: ssh-keygen -t ed25519"
  fi

  # Upload to hcloud
  hcloud ssh-key create --name "$key_name" --public-key-from-file "${local_key}.pub"
  SSH_KEY_NAME="$key_name"
  log_success "SSH key uploaded: $key_name"
}

#######################################
# Check if server already exists
#######################################
check_existing_server() {
  if hcloud server describe "$SERVER_NAME" &> /dev/null; then
    log_warn "Server '$SERVER_NAME' already exists"
    read -rp "Delete and recreate? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      log_info "Deleting existing server..."
      hcloud server delete "$SERVER_NAME"
      sleep 5
    else
      die "Aborted. Use teardown.sh to remove the existing server."
    fi
  fi
}

#######################################
# Generate cloud-init config
#######################################
generate_cloud_init() {
  log_info "Generating cloud-init config..."

  local template="$SCRIPT_DIR/cloud-init.yaml.tmpl"
  local output="$scratch/cloud-init.yaml"

  if [[ ! -f "$template" ]]; then
    die "cloud-init template not found: $template"
  fi

  # Substitute variables
  sed \
    -e "s|__TS_OAUTH_SECRET__|${TS_OAUTH_SECRET}|g" \
    -e "s|__TS_TAG__|${TS_TAG}|g" \
    -e "s|__GH_REPO__|${GH_REPO}|g" \
    "$template" > "$output"

  CLOUD_INIT_FILE="$output"
  log_success "Cloud-init config generated"
}

#######################################
# Create server
#######################################
create_server() {
  log_info "Creating server..."

  hcloud server create \
    --name "$SERVER_NAME" \
    --type "$HETZNER_SERVER_TYPE" \
    --image debian-13 \
    --location "$HETZNER_LOCATION" \
    --ssh-key "$SSH_KEY_NAME" \
    --user-data-from-file "$CLOUD_INIT_FILE"

  # Get server IPs
  SERVER_IP=$(hcloud server ip "$SERVER_NAME")
  # hcloud returns a /64 prefix (e.g., 2a01:4f8::/64), convert to usable address
  local ip6_raw
  ip6_raw=$(hcloud server ip -6 "$SERVER_NAME" | head -1)
  if [[ -n "$ip6_raw" && "$ip6_raw" =~ ^([^/]+):: ]]; then
    SERVER_IP6="${BASH_REMATCH[1]}::1"
  else
    SERVER_IP6=""
  fi
  log_success "Server created: $SERVER_IP${SERVER_IP6:+ / $SERVER_IP6}"
}

#######################################
# Update Cloudflare DNS
#######################################
update_dns_record() {
  local record_type="$1"
  local fqdn="$2"
  local content="$3"
  local api_base="https://api.cloudflare.com/client/v4"

  # Check if record exists
  local existing
  existing=$(curl -s -X GET \
    "$api_base/zones/$CLOUDFLARE_ZONE_ID/dns_records?type=$record_type&name=$fqdn" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json")

  local record_id
  record_id=$(echo "$existing" | jq -r '.result[0].id // empty')

  if [[ -n "$record_id" ]]; then
    # Update existing record
    curl -s -X PUT \
      "$api_base/zones/$CLOUDFLARE_ZONE_ID/dns_records/$record_id" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"$record_type\",\"name\":\"$fqdn\",\"content\":\"$content\",\"ttl\":300,\"proxied\":false}" \
      | jq -e '.success' > /dev/null
    log_success "DNS $record_type updated: $fqdn -> $content"
  else
    # Create new record
    curl -s -X POST \
      "$api_base/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"$record_type\",\"name\":\"$fqdn\",\"content\":\"$content\",\"ttl\":300,\"proxied\":false}" \
      | jq -e '.success' > /dev/null
    log_success "DNS $record_type created: $fqdn -> $content"
  fi
}

update_dns() {
  log_info "Updating Cloudflare DNS..."

  local fqdn="${SUBDOMAIN}.${DOMAIN}"

  # Create/update A record (IPv4)
  update_dns_record "A" "$fqdn" "$SERVER_IP"

  # Create/update AAAA record (IPv6)
  if [[ -n "$SERVER_IP6" ]]; then
    update_dns_record "AAAA" "$fqdn" "$SERVER_IP6"
  fi
}

#######################################
# Wait for server to be ready
#######################################
wait_for_server() {
  log_info "Waiting for server to be ready..."

  local max_attempts=60
  local attempt=0

  # Wait for SSH
  while [[ $attempt -lt $max_attempts ]]; do
    if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o BatchMode=yes \
       "root@$SERVER_IP" "echo ok" &> /dev/null; then
      break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 5
  done
  echo

  if [[ $attempt -ge $max_attempts ]]; then
    die "Timeout waiting for SSH"
  fi

  # Capture host key for future connections
  ssh-keyscan -H "$SERVER_IP" >> ~/.ssh/known_hosts 2>/dev/null || true

  log_success "SSH is available"

  # Wait for cloud-init to complete, streaming log output in real-time
  log_info "Waiting for cloud-init to complete (streaming log)..."

  # Start tail -f in background
  ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
    "tail -f /var/log/cloud-init-output.log 2>/dev/null" &
  local tail_pid=$!

  # Poll for completion file
  attempt=0
  while [[ $attempt -lt $max_attempts ]]; do
    if ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
       "test -f /opt/.cloud-init-complete" &> /dev/null; then
      break
    fi
    attempt=$((attempt + 1))
    sleep 5
  done

  # Stop the tail process
  kill "$tail_pid" 2>/dev/null || true
  wait "$tail_pid" 2>/dev/null || true

  if [[ $attempt -ge $max_attempts ]]; then
    die "Timeout waiting for cloud-init"
  fi

  log_success "Cloud-init completed"
}

#######################################
# Get Tailscale IP
#######################################
get_tailscale_ip() {
  log_info "Getting Tailscale IP..."

  TAILSCALE_IP=$(ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
    "tailscale ip -4" 2>/dev/null || echo "")

  if [[ -z "$TAILSCALE_IP" ]]; then
    log_warn "Could not get Tailscale IP. Check Tailscale auth."
  else
    log_success "Tailscale IP: $TAILSCALE_IP"
  fi
}

#######################################
# Generate and upload .env file
#######################################
upload_env_file() {
  log_info "Generating .env file..."

  local env_file="$scratch/.env"
  local fqdn="${SUBDOMAIN}.${DOMAIN}"

  cat > "$env_file" << EOF
# Generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# === Server ===
PORT=3000
NODE_ENV=production

# === Letta ===
LETTA_BASE_URL=http://letta:8283
LETTA_SERVER_PASSWORD=${LETTA_SERVER_PASSWORD}

# === Telegram ===
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_WEBHOOK_URL=https://${fqdn}/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=${TELEGRAM_WEBHOOK_SECRET_TOKEN}

# === Anthropic Proxy ===
ANTHROPIC_PROXY_URL=http://anthropic-proxy:4001/v1
ANTHROPIC_PROXY_SESSION_SECRET=${ANTHROPIC_PROXY_SESSION_SECRET}
ANTHROPIC_PROXY_SESSION_ID=

# === LiteLLM ===
LITELLM_URL=http://litellm:4000

# === OpenAI ===
OPENAI_API_KEY=${OPENAI_API_KEY}

# === Database ===
DB_PATH=/app/data/assistant.db

# === Tool Webhooks ===
TOOL_WEBHOOK_URL=http://app:3000

# === Monitoring ===
NETDATA_CLAIM_TOKEN=${NETDATA_CLAIM_TOKEN:-}
EOF

  log_info "Uploading .env file..."
  scp -o StrictHostKeyChecking=no "$env_file" "root@$SERVER_IP:/opt/assistant/.env"
  log_success ".env file uploaded"
}

#######################################
# Generate and upload Caddyfile
#######################################
upload_caddyfile() {
  log_info "Generating Caddyfile..."

  local caddyfile="$scratch/Caddyfile"
  local fqdn="${SUBDOMAIN}.${DOMAIN}"

  cat > "$caddyfile" << EOF
# Generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Main app - Telegram webhook
${fqdn} {
    reverse_proxy app:3000
}

# Netdata and Letta are accessed via Tailscale only
# http://TAILSCALE_IP:19999 - Netdata
# http://TAILSCALE_IP:8283  - Letta
# http://TAILSCALE_IP:4001  - Anthropic Proxy (for OAuth setup)
EOF

  log_info "Uploading Caddyfile..."
  scp -o StrictHostKeyChecking=no "$caddyfile" "root@$SERVER_IP:/opt/assistant/Caddyfile"
  log_success "Caddyfile uploaded"
}

#######################################
# Upload system prompt
#######################################
upload_system_prompt() {
  log_info "Uploading system prompt..."

  local prompt_file="$SCRIPT_DIR/../prompts/SYSTEM_PROMPT.md"

  if [[ ! -f "$prompt_file" ]]; then
    log_warn "System prompt not found: $prompt_file"
    log_warn "Create it from the example: cp prompts/SYSTEM_PROMPT.md.example prompts/SYSTEM_PROMPT.md"
    return
  fi

  ssh -T -o StrictHostKeyChecking=no "root@$SERVER_IP" "mkdir -p /opt/assistant/prompts"
  scp -o StrictHostKeyChecking=no "$prompt_file" "root@$SERVER_IP:/opt/assistant/prompts/SYSTEM_PROMPT.md"
  ssh -T -o StrictHostKeyChecking=no "root@$SERVER_IP" "chown -R 1000:1000 /opt/assistant/prompts"
  log_success "System prompt uploaded"
}

#######################################
# Start services
#######################################
start_services() {
  log_info "Pulling pre-built images..."

  ssh -T -o StrictHostKeyChecking=no "root@$SERVER_IP" << 'EOF'
cd /opt/assistant
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull --ignore-buildable
EOF

  log_success "Images pulled"
  log_info "Building custom images..."

  ssh -T -o StrictHostKeyChecking=no "root@$SERVER_IP" << 'EOF'
cd /opt/assistant
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
EOF

  log_success "Images built"
  log_info "Starting services..."

  ssh -T -o StrictHostKeyChecking=no "root@$SERVER_IP" << 'EOF'
cd /opt/assistant
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
EOF

  log_success "Services started"
}

#######################################
# Wait for health check
#######################################
wait_for_health() {
  log_info "Waiting for services to be healthy..."

  local fqdn="${SUBDOMAIN}.${DOMAIN}"
  local max_attempts=30
  local attempt=0

  while [[ $attempt -lt $max_attempts ]]; do
    if curl -sf "https://${fqdn}/health" &> /dev/null; then
      break
    fi
    attempt=$((attempt + 1))
    # Show container health status
    local status
    status=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@$SERVER_IP" \
      "cd /opt/assistant && docker compose -f docker-compose.yml -f docker-compose.prod.yml ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null | tail -n +2 | tr '\n' ' '" 2>/dev/null || echo "connecting...")
    printf "\r  %-100s" "$status"
    sleep 10
  done
  printf "\r%-110s\n" ""  # Clear the status line

  if [[ $attempt -ge $max_attempts ]]; then
    log_warn "Health check timeout. Services may still be starting."
    log_info "Check logs with: ssh root@$SERVER_IP 'docker compose -f /opt/assistant/docker-compose.yml -f /opt/assistant/docker-compose.prod.yml logs -f'"
  else
    log_success "Services healthy"
  fi
}

#######################################
# Set Telegram webhook
#######################################
set_telegram_webhook() {
  log_info "Setting Telegram webhook..."

  local fqdn="${SUBDOMAIN}.${DOMAIN}"
  local webhook_url="https://${fqdn}/webhook"

  local response
  response=$(curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$webhook_url\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET_TOKEN\"}")

  if echo "$response" | jq -e '.ok' > /dev/null; then
    log_success "Telegram webhook set: $webhook_url"
  else
    log_warn "Failed to set webhook: $response"
  fi
}

#######################################
# Get deploy key for GitHub Actions
#######################################
get_deploy_key() {
  log_info "Getting deploy key for GitHub Actions..."

  DEPLOY_KEY_PUBLIC=$(ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
    "cat /root/.ssh/deploy_key.pub" 2>/dev/null || echo "")

  # Write private key to file with restricted permissions (never print to stdout)
  DEPLOY_KEY_FILE="$SCRIPT_DIR/deploy_key_${SERVER_NAME}"
  ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
    "cat /root/.ssh/deploy_key" 2>/dev/null > "$DEPLOY_KEY_FILE" || true

  if [[ -s "$DEPLOY_KEY_FILE" ]]; then
    chmod 600 "$DEPLOY_KEY_FILE"
    log_success "Deploy key saved to: $DEPLOY_KEY_FILE"
  else
    rm -f "$DEPLOY_KEY_FILE"
    DEPLOY_KEY_FILE=""
    log_warn "Could not retrieve deploy key"
  fi
}

#######################################
# Print summary
#######################################
print_summary() {
  local fqdn="${SUBDOMAIN}.${DOMAIN}"

  echo
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}   Deployment Complete!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo
  echo -e "${BLUE}Server:${NC}"
  echo "  IPv4:         $SERVER_IP"
  echo "  IPv6:         ${SERVER_IP6:-'(none)'}"
  echo "  Tailscale:    ${TAILSCALE_IP:-'(check Tailscale admin)'}"
  echo
  echo -e "${BLUE}Service URLs:${NC}"
  echo "  App (public):           https://${fqdn}"
  echo "  Health check:           https://${fqdn}/health"
  if [[ -n "${TAILSCALE_IP:-}" ]]; then
    echo "  Letta (Tailscale):      http://${TAILSCALE_IP}:8283"
    echo "  Netdata (Tailscale):    http://${TAILSCALE_IP}:19999"
    echo "  OAuth setup (Tailscale): http://${TAILSCALE_IP}:4001/auth/device"
  fi
  echo
  echo -e "${YELLOW}NEXT STEP: Complete Anthropic OAuth${NC}"
  echo "  Open this URL from any device on your Tailscale network:"
  if [[ -n "${TAILSCALE_IP:-}" ]]; then
    echo "    http://${TAILSCALE_IP}:4001/auth/device"
  else
    echo "    http://<TAILSCALE_IP>:4001/auth/device"
  fi
  echo
  echo "  After completing OAuth, copy the session ID and run:"
  echo "    ssh root@$SERVER_IP"
  echo "    nano /opt/assistant/.env"
  echo "    # Set ANTHROPIC_PROXY_SESSION_ID=your_session_id"
  echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml restart"
  echo
  if [[ -n "${DEPLOY_KEY_PUBLIC:-}" ]]; then
    echo -e "${BLUE}GitHub Actions Setup:${NC}"
    echo "  Add this deploy key to GitHub (Settings → Deploy keys):"
    echo "  $DEPLOY_KEY_PUBLIC"
    echo
    echo "  Add these secrets to GitHub Actions (Settings → Secrets):"
    echo "    HOST: $SERVER_IP"
    if [[ -n "${DEPLOY_KEY_FILE:-}" ]]; then
      echo "    SSH_KEY: contents of $DEPLOY_KEY_FILE"
    fi
    echo
  fi
  echo -e "${BLUE}Useful commands:${NC}"
  echo "  SSH:        ssh root@$SERVER_IP"
  echo "  Logs:       ssh root@$SERVER_IP 'cd /opt/assistant && docker compose logs -f'"
  echo "  Restart:    ssh root@$SERVER_IP 'cd /opt/assistant && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart'"
  echo "  Teardown:   ./teardown.sh"
  echo
}

#######################################
# Main
#######################################
main() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}   Assistant Deployment Script${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo

  check_prerequisites
  load_secrets
  setup_ssh_key
  check_existing_server
  generate_cloud_init
  create_server
  update_dns
  wait_for_server
  get_tailscale_ip
  upload_env_file
  upload_caddyfile
  upload_system_prompt
  start_services
  wait_for_health
  set_telegram_webhook
  get_deploy_key
  print_summary
}

main "$@"
