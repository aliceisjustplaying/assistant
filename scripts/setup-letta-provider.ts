#!/usr/bin/env bun
/**
 * Setup script to add anthropic-proxy as a custom LLM provider in Letta
 *
 * This configures Letta to use the anthropic-proxy service, which provides
 * an OpenAI-compatible API that proxies to Anthropic's Claude models.
 *
 * Run: bun scripts/setup-letta-provider.ts
 */

const LETTA_BASE_URL = process.env['LETTA_BASE_URL'] ?? 'http://localhost:8283';
const SESSION_ID = process.env['ANTHROPIC_PROXY_SESSION_ID'] ?? '';

// Validate session ID is set
if (SESSION_ID === '') {
  console.error('Error: ANTHROPIC_PROXY_SESSION_ID is not set in .env');
  console.error('Complete the OAuth flow first: http://localhost:4001/auth/device');
  process.exit(1);
}

// The anthropic-proxy uses the session ID as the x-api-key header
// Letta will pass this as Authorization: Bearer <api_key> which the proxy accepts
const PROVIDER_CONFIG = {
  name: 'claude-proxy', // Using different name to avoid Letta soft-delete constraint issues
  provider_type: 'openai', // OpenAI-compatible API
  api_key: SESSION_ID, // Session ID is used as the API key
  base_url: 'http://anthropic-proxy:4001/v1', // Docker internal network
};

interface Provider {
  id: string;
  name: string;
  api_key?: string;
}

async function getExistingProvider(): Promise<Provider | null> {
  try {
    const response = await fetch(`${LETTA_BASE_URL}/v1/providers/`);
    if (!response.ok) {
      return null;
    }
    const providers = (await response.json()) as Provider[];
    return providers.find((p) => p.name === PROVIDER_CONFIG.name) ?? null;
  } catch {
    return null;
  }
}

async function updateProvider(providerId: string): Promise<boolean> {
  console.log(`Updating provider ${providerId} with new API key...`);
  const response = await fetch(`${LETTA_BASE_URL}/v1/providers/${providerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: SESSION_ID }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Warning: Could not update provider: ${errorText}`);
    return false;
  }
  return true;
}

async function createProvider(): Promise<void> {
  console.log('Adding anthropic-proxy provider to Letta...');
  console.log(`  Letta URL: ${LETTA_BASE_URL}`);
  console.log(`  Provider: ${PROVIDER_CONFIG.name}`);
  console.log(`  Type: ${PROVIDER_CONFIG.provider_type}`);
  console.log(`  Base URL: ${PROVIDER_CONFIG.base_url}`);

  const response = await fetch(`${LETTA_BASE_URL}/v1/providers/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PROVIDER_CONFIG),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create provider: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as { id: string; name: string };
  console.log(`\nProvider created successfully!`);
  console.log(`  ID: ${result.id}`);
  console.log(`  Name: ${result.name}`);
}

async function listModels(): Promise<void> {
  console.log('\nAvailable models:');
  const response = await fetch(`${LETTA_BASE_URL}/v1/models/`);
  if (!response.ok) {
    console.log('  (Could not fetch models)');
    return;
  }
  const models = (await response.json()) as Array<{ handle: string; provider_name: string }>;
  for (const model of models) {
    console.log(`  - ${model.handle} (${model.provider_name})`);
  }
}

async function main(): Promise<void> {
  console.log('=== Letta Provider Setup ===\n');

  // Check if Letta is running
  try {
    const health = await fetch(`${LETTA_BASE_URL}/v1/health/`);
    if (!health.ok) {
      throw new Error('Letta health check failed');
    }
    console.log('Letta is running.\n');
  } catch (error) {
    console.error('Error: Letta is not accessible at', LETTA_BASE_URL);
    console.error('Make sure to run: docker compose up -d');
    process.exit(1);
  }

  // Check if provider already exists
  const existing = await getExistingProvider();
  if (existing !== null) {
    console.log(`Provider "anthropic-proxy" already exists (ID: ${existing.id})`);
    const updated = await updateProvider(existing.id);
    if (updated) {
      console.log('Provider updated successfully with current session ID.');
      await listModels();
      console.log('\nSetup complete! You can now run: bun run dev');
      return;
    }
    console.log('Update failed, provider may already have correct configuration.');
    await listModels();
    return;
  }

  // Create the provider
  await createProvider();
  await listModels();

  console.log('\nSetup complete! You can now run: bun run dev');
}

main().catch((error: unknown) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
