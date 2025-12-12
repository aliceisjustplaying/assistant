#!/bin/bash
set -e

cd /opt/assistant
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker image prune -f
