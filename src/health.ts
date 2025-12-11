/**
 * Health check module for ADHD Support Agent
 *
 * Checks the health of all critical dependencies:
 * - Letta API server
 * - Anthropic proxy
 * - Database (optional for M0, will be enabled in M2)
 *
 * Returns 200 if all services are healthy, 503 if any are down.
 */

import { config } from './config';

export interface HealthCheckResult {
  healthy: boolean;
  checks: {
    db: boolean;
    letta: boolean;
    proxy: boolean;
  };
}

/**
 * Perform health checks on all critical services
 *
 * @returns Response with health status (200 if healthy, 503 if unhealthy)
 */
export async function healthCheck(): Promise<Response> {
  const checks = {
    db: false,
    letta: false,
    proxy: false,
  };

  // DB: Optional for M0 (database module doesn't exist yet)
  // Will be enabled in M2 when src/db/index.ts exists
  // For now, we skip the DB check entirely - it will be implemented in M2
  checks.db = true;

  // Letta: Check health endpoint (fast, doesn't query agents)
  try {
    const res = await fetch(`${config.LETTA_BASE_URL}/v1/health/`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    checks.letta = res.ok;
  } catch (error) {
    console.error('Letta health check failed:', error);
    checks.letta = false;
  }

  // Proxy: Check health endpoint
  try {
    const proxyHealthUrl = config.ANTHROPIC_PROXY_URL.replace('/v1', '/health');
    const res = await fetch(proxyHealthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    checks.proxy = res.ok;
  } catch (error) {
    console.error('Proxy health check failed:', error);
    checks.proxy = false;
  }

  // Overall health: all checks must pass
  const healthy = Object.values(checks).every(Boolean);

  const result: HealthCheckResult = {
    healthy,
    checks,
  };

  return new Response(JSON.stringify(result), {
    status: healthy ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Simplified version for M0 that only checks if the server is running
 * Can be used before dependencies are fully set up
 *
 * @returns Response indicating server is alive
 */
export function simpleHealthCheck(): Response {
  return new Response(
    JSON.stringify({
      healthy: true,
      checks: {
        server: true,
      },
      message: 'Server is running (M0 - basic health check)',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
