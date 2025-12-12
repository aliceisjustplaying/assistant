/**
 * Auth adapter proxy for anthropic-proxy
 *
 * Translates Authorization: Bearer <token> to x-api-key: <token>
 * This allows Letta (which uses OpenAI-style auth) to communicate
 * with anthropic-proxy (which expects x-api-key header).
 *
 * Run: bun src/auth-adapter.ts
 */

const PROXY_TARGET = process.env['ANTHROPIC_PROXY_INTERNAL_URL'] ?? 'http://localhost:4001';
const PORT = Number(process.env['AUTH_ADAPTER_PORT'] ?? '4002');

console.log(`Auth adapter starting on port ${PORT.toString()}`);
console.log(`Proxying to: ${PROXY_TARGET}`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const targetUrl = `${PROXY_TARGET}${url.pathname}${url.search}`;

    console.log(`[${req.method}] ${url.pathname}`);

    // Clone headers and translate auth
    const headers = new Headers(req.headers);

    // Extract Bearer token and convert to x-api-key
    // Also handle case where LiteLLM sends x-api-key directly (for Anthropic provider)
    const authHeader = headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      headers.set('x-api-key', token);
      headers.delete('Authorization');
    }
    // If x-api-key is already set (by LiteLLM's Anthropic provider), it passes through

    // Request uncompressed responses (Letta can't handle gzip)
    headers.set('Accept-Encoding', 'identity');

    // Forward the request
    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      });

      console.log(`  Response: ${response.status.toString()}`);

      // Return the response
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      console.error('Proxy error:', error);
      return new Response(JSON.stringify({ error: 'Proxy error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
});

console.log(`Auth adapter listening on http://localhost:${PORT.toString()}`);
