# Health Check Module

The health check module provides endpoints to verify that all critical services are operational.

## Overview

The health check module exports two functions:

1. **`healthCheck()`** - Full health check for all services (Letta, Anthropic Proxy, Database)
2. **`simpleHealthCheck()`** - Basic check that only verifies the server is running (M0 fallback)

## Usage

### In src/index.ts

```typescript
import { healthCheck } from "./health";

Bun.serve({
  port: config.PORT,
  fetch: async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return await healthCheck();
    }

    // ... other routes
  },
});
```

### Response Format

```json
{
  "healthy": true,
  "checks": {
    "db": true,
    "letta": true,
    "proxy": true
  }
}
```

- **Status 200**: All services healthy
- **Status 503**: One or more services unhealthy

## Service Checks

### Database (M0: Optional, M2+: Required)

In M0, the database module doesn't exist yet, so the check is skipped and returns `true`.

In M2+, the check will use `bun:sqlite` to execute a simple query:
```typescript
sqlite.query("SELECT 1").get();
```

### Letta

Checks the Letta API health endpoint:
```
GET ${LETTA_BASE_URL}/v1/health
```

This is fast and doesn't query the agents list.

### Anthropic Proxy

Checks the anthropic-proxy health endpoint:
```
GET ${ANTHROPIC_PROXY_URL}/health
```

Note: The URL is transformed from `/v1` to `/health`.

## Configuration

The health check uses the following environment variables from `src/config.ts`:

- `LETTA_BASE_URL` - Base URL for Letta API
- `ANTHROPIC_PROXY_URL` - Base URL for Anthropic proxy

## Timeouts

All health checks have a 5-second timeout to prevent hanging.

## Docker Compose Integration

The health check is used in `docker-compose.yml` for service health monitoring:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Testing

Run the health check tests:

```bash
bun test src/health.test.ts
```

## Simple Health Check (M0)

For M0 development before all dependencies are ready, use `simpleHealthCheck()`:

```typescript
import { simpleHealthCheck } from "./health";

if (url.pathname === "/health") {
  return simpleHealthCheck();
}
```

This returns a basic response indicating the server is running, without checking external dependencies.
