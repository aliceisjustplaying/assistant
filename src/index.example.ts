/**
 * Example usage of health check in main server file
 *
 * This shows how to integrate the health check into src/index.ts
 * when it's ready to be created.
 */

import { config } from './config';
import { healthCheck, simpleHealthCheck } from './health';

// Example 1: Use full health check (M0+)
Bun.serve({
  port: config.PORT,
  fetch: async (req): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      // Use full health check with Letta + Proxy checks
      return await healthCheck();
    }

    return new Response('Not Found', { status: 404 });
  },
});

// Example 2: Use simple health check (M0 only, before dependencies are ready)
Bun.serve({
  port: config.PORT,
  fetch: (req): Response => {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      // Use simple health check that only verifies server is running
      return simpleHealthCheck();
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running on http://localhost:${config.PORT.toString()}`);
console.log(`Health check available at http://localhost:${config.PORT.toString()}/health`);
