#!/usr/bin/env bash
# Migrate local data to production server
#
# Syncs:
#   - SQLite database (assistant.db)
#   - Letta agent state (.af file)
#
# Usage:
#   ./migrate-data.sh

set -euo pipefail
IFS=$'\n\t'

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_HOST="assistant-vps"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
die() { log_error "$1"; exit 1; }

#######################################
# Sync SQLite database
#######################################
sync_sqlite() {
  log_info "Syncing SQLite database..."

  local db_file="$PROJECT_DIR/data/assistant.db"

  if [[ ! -f "$db_file" ]]; then
    log_warn "No local database found: $db_file"
    return
  fi

  # Checkpoint WAL to ensure all data is in main db file
  if command -v sqlite3 &> /dev/null; then
    sqlite3 "$db_file" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
  fi

  # Copy to server
  scp "$db_file" "$SERVER_HOST:/opt/assistant/data/assistant.db"
  ssh "$SERVER_HOST" "chown 1000:1000 /opt/assistant/data/assistant.db"

  log_success "SQLite database synced"
}

#######################################
# Export local Letta agent
#######################################
export_letta_agent() {
  log_info "Exporting local Letta agent..."

  local export_file="$SCRIPT_DIR/agent_export.af"

  # Run TypeScript export script
  cd "$PROJECT_DIR"
  bun run --silent - << 'TYPESCRIPT'
import { Letta } from '@letta-ai/letta-client';

const AGENT_NAME = 'adhd-support-agent';

async function main() {
  // Connect to local Letta (dev mode)
  const client = new Letta({
    baseURL: process.env.LETTA_BASE_URL || 'http://localhost:8283',
  });

  // Find agent by name
  let agentId: string | null = null;
  for await (const agent of client.agents.list()) {
    if (agent.name === AGENT_NAME) {
      agentId = agent.id;
      break;
    }
  }

  if (!agentId) {
    console.error(`Agent '${AGENT_NAME}' not found locally`);
    process.exit(1);
  }

  console.log(`Found agent: ${agentId}`);

  // Export agent to .af file
  const exported = await client.agents.exportAgentSerialized(agentId);

  // Write to file
  const fs = await import('fs');
  fs.writeFileSync('infra/agent_export.af', Buffer.from(exported));

  console.log('Agent exported to infra/agent_export.af');
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
TYPESCRIPT

  if [[ ! -f "$export_file" ]]; then
    log_warn "Agent export failed or no local agent exists"
    return 1
  fi

  log_success "Agent exported to $export_file"
  return 0
}

#######################################
# Import Letta agent to production
#######################################
import_letta_agent() {
  log_info "Importing agent to production Letta..."

  local export_file="$SCRIPT_DIR/agent_export.af"

  if [[ ! -f "$export_file" ]]; then
    log_warn "No agent export file found: $export_file"
    return
  fi

  # Copy export file to server
  scp "$export_file" "$SERVER_HOST:/tmp/agent_export.af"

  # Run import on server
  ssh "$SERVER_HOST" << 'EOF'
cd /opt/assistant

# Load env for Letta password
source .env

# Run import script inside app container
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T app bun run --silent - << 'TYPESCRIPT'
import { Letta } from '@letta-ai/letta-client';
import { readFileSync } from 'fs';

const AGENT_NAME = 'adhd-support-agent';

async function main() {
  const client = new Letta({
    baseURL: process.env.LETTA_BASE_URL || 'http://letta:8283',
    apiKey: process.env.LETTA_SERVER_PASSWORD || undefined,
  });

  // Check if agent already exists
  for await (const agent of client.agents.list()) {
    if (agent.name === AGENT_NAME) {
      console.log(`Agent '${AGENT_NAME}' already exists (${agent.id}), deleting...`);
      await client.agents.delete(agent.id);
      break;
    }
  }

  // Import agent from .af file
  const fileData = readFileSync('/tmp/agent_export.af');
  const blob = new Blob([fileData]);

  const imported = await client.agents.importAgentSerialized(blob, {});
  console.log(`Agent imported: ${imported.id}`);
  console.log(`Name: ${imported.name}`);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
TYPESCRIPT
EOF

  # Cleanup
  ssh "$SERVER_HOST" "rm -f /tmp/agent_export.af"
  rm -f "$export_file"

  log_success "Agent imported to production"
}

#######################################
# Restart app to pick up changes
#######################################
restart_app() {
  log_info "Restarting app container..."
  ssh "$SERVER_HOST" "cd /opt/assistant && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart app"
  log_success "App restarted"
}

#######################################
# Main
#######################################
main() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}   Data Migration Script${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo

  # Check SSH connectivity
  if ! ssh -o ConnectTimeout=5 "$SERVER_HOST" "echo ok" &> /dev/null; then
    die "Cannot connect to $SERVER_HOST"
  fi

  sync_sqlite

  if export_letta_agent; then
    import_letta_agent
  fi

  restart_app

  echo
  log_success "Migration complete!"
}

main "$@"
