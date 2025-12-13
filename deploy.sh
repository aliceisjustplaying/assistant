#!/bin/bash
set -e

cd /opt/assistant

# Backup .env before git pull might overwrite it
if [[ -f .env ]]; then
  cp .env ".env.backup.$(date +%s)"
fi

git pull origin main

# Build images in parallel, then start
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --parallel
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Wait for services to be healthy before pruning
echo "Waiting for services to be healthy..."
sleep 10
if docker compose -f docker-compose.yml -f docker-compose.prod.yml ps | grep -q "unhealthy\|Exit"; then
  echo "Warning: Some services may not be healthy"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
else
  docker image prune -f
fi
