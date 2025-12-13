#!/usr/bin/env bash
# Quick-sync system prompt to server without full deploy
#
# Usage:
#   ./sync-prompt.sh

set -euo pipefail
IFS=$'\n\t'

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_NAME="assistant"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
die() { log_error "$1"; exit 1; }

# Get server IP
if ! command -v hcloud &> /dev/null; then
  die "hcloud CLI not found"
fi

SERVER_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null) || die "Server '$SERVER_NAME' not found"

# Check prompt file exists
PROMPT_FILE="$PROJECT_DIR/prompts/SYSTEM_PROMPT.md"
if [[ ! -f "$PROMPT_FILE" ]]; then
  die "System prompt not found: $PROMPT_FILE"
fi

log_info "Syncing system prompt to $SERVER_IP..."

# Upload prompt
scp -o StrictHostKeyChecking=no "$PROMPT_FILE" "root@$SERVER_IP:/opt/assistant/prompts/SYSTEM_PROMPT.md"
log_success "Prompt uploaded"

# Restart app container only (fast, no rebuild)
log_info "Restarting app container..."
ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" \
  "cd /opt/assistant && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart app"

log_success "Done! App restarted with new prompt."
