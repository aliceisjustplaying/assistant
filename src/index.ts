/**
 * Main entry point for the ADHD Support Agent
 *
 * This Bun HTTP server provides:
 * - Health check endpoints for monitoring
 * - Telegram webhook endpoint for receiving messages
 * - Bot initialization and message handling
 *
 * Uses Bun.serve() for high-performance HTTP handling.
 */

import { config, isWebhookMode } from './config';
import { healthCheck, simpleHealthCheck } from './health';
import { initializeLetta } from './letta';
import { handleUpdate, startPolling } from './bot';
import type { Update } from 'telegraf/types';

/**
 * Main server handler using Bun.serve()
 */
async function main(): Promise<void> {
  console.log('Starting ADHD Support Agent...');

  // Initialize Letta before starting the server
  try {
    await initializeLetta();
  } catch (error) {
    console.error('Failed to initialize Letta:', error);
    console.error('Server will start, but bot functionality may be limited.');
  }

  // Start the HTTP server
  Bun.serve({
    port: config.PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /health - Full health check
      if (path === '/health' && req.method === 'GET') {
        return await healthCheck();
      }

      // GET /healthz - Simple health check (k8s liveness probe)
      if (path === '/healthz' && req.method === 'GET') {
        return simpleHealthCheck();
      }

      // POST /webhook - Telegram webhook endpoint
      if (path === '/webhook' && req.method === 'POST') {
        // Verify the secret token
        const token = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (token === null || token !== config.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
          console.warn('Webhook request with invalid or missing secret token');
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Parse the Telegram update
        let update: Update;
        try {
          update = (await req.json()) as Update;
        } catch (error) {
          console.error('Failed to parse webhook body:', error);
          return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Handle the update (fire and forget - Telegram expects quick response)
        handleUpdate(update).catch((error: unknown) => {
          console.error('Error handling update:', error);
        });

        // Return 200 OK immediately
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 404 for unknown routes
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  console.log(`Server listening on http://localhost:${config.PORT.toString()}`);

  // Start bot in appropriate mode
  if (isWebhookMode()) {
    console.log(`Webhook mode enabled: ${config.TELEGRAM_WEBHOOK_URL}`);
  } else {
    console.log('Webhook mode disabled, starting polling for development...');
    try {
      await startPolling();
    } catch (error) {
      console.error('Failed to start polling mode:', error);
      console.error('Bot will not receive messages in polling mode.');
    }
  }

  console.log('ADHD Support Agent is ready!');
}

// Start the server
main().catch((error: unknown) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
