#!/usr/bin/env bash
# Teardown assistant server and DNS records
#
# Usage:
#   ./teardown.sh

set -euo pipefail
IFS=$'\n\t'

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_NAME="assistant"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
die() { log_error "$1"; exit 1; }

echo -e "${RED}========================================${NC}"
echo -e "${RED}   Assistant Teardown${NC}"
echo -e "${RED}========================================${NC}"
echo

# Confirm
echo -e "${YELLOW}This will delete:${NC}"
echo "  - Hetzner server: $SERVER_NAME"
echo "  - DNS records (if secrets.env is available)"
echo
read -rp "Are you sure? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Load secrets for DNS cleanup (optional)
if [[ -f "$SCRIPT_DIR/secrets.env" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/secrets.env"
fi

# Delete server
if hcloud server describe "$SERVER_NAME" &> /dev/null; then
  log_info "Deleting server..."
  hcloud server delete "$SERVER_NAME"
  log_success "Server deleted"
else
  log_warn "Server '$SERVER_NAME' not found"
fi

# Delete DNS records (if we have the credentials)
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] && [[ -n "${CLOUDFLARE_ZONE_ID:-}" ]] && [[ -n "${SUBDOMAIN:-}" ]] && [[ -n "${DOMAIN:-}" ]]; then
  log_info "Deleting DNS records..."

  fqdn="${SUBDOMAIN}.${DOMAIN}"
  api_base="https://api.cloudflare.com/client/v4"

  # Delete both A and AAAA records
  for record_type in A AAAA; do
    existing=$(curl -s -X GET \
      "$api_base/zones/$CLOUDFLARE_ZONE_ID/dns_records?type=$record_type&name=$fqdn" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json")

    record_id=$(echo "$existing" | jq -r '.result[0].id // empty')

    if [[ -n "$record_id" ]]; then
      curl -s -X DELETE \
        "$api_base/zones/$CLOUDFLARE_ZONE_ID/dns_records/$record_id" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        | jq -e '.success' > /dev/null
      log_success "DNS $record_type deleted: $fqdn"
    fi
  done
else
  log_warn "Skipping DNS cleanup (secrets not available)"
fi

# Delete SSH key (optional)
read -rp "Delete SSH key from Hetzner? [y/N] " delete_key
if [[ "$delete_key" =~ ^[Yy]$ ]]; then
  if hcloud ssh-key describe "assistant-deploy" &> /dev/null; then
    hcloud ssh-key delete "assistant-deploy"
    log_success "SSH key deleted"
  else
    log_warn "SSH key 'assistant-deploy' not found"
  fi
fi

echo
log_success "Teardown complete"
echo
echo "Note: Tailscale device may still appear in your admin console."
echo "Remove it manually at: https://login.tailscale.com/admin/machines"
