#!/usr/bin/env bun
/**
 * Verification script to check Letta + LiteLLM + anthropic-proxy setup
 *
 * This verifies that:
 * 1. Letta is running and healthy
 * 2. Claude models are available via LiteLLM (configured via OPENAI_API_BASE)
 * 3. The proxy chain is working
 *
 * Run: bun scripts/setup-letta-provider.ts
 */

const LETTA_BASE_URL = process.env['LETTA_BASE_URL'] ?? 'http://localhost:8283';

interface Model {
  handle: string;
  provider_name: string;
  model_endpoint?: string;
}

async function listModels(): Promise<Model[]> {
  const response = await fetch(`${LETTA_BASE_URL}/v1/models/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  return (await response.json()) as Model[];
}

async function testAgentCreation(): Promise<boolean> {
  // Create a test agent with letta-free, then update to Claude
  console.log('Testing agent creation workflow...');

  // Step 1: Create agent with letta-free
  const createResponse = await fetch(`${LETTA_BASE_URL}/v1/agents/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `test-setup-${Date.now().toString()}`,
      model: 'letta/letta-free',
      embedding: 'letta/letta-free',
      memory_blocks: [{ label: 'persona', value: 'Test agent' }],
    }),
  });

  if (!createResponse.ok) {
    console.error('  Failed to create test agent:', await createResponse.text());
    return false;
  }

  const agent = (await createResponse.json()) as { id: string };
  console.log(`  Created test agent: ${agent.id}`);

  // Step 2: Update to Claude
  const updateResponse = await fetch(`${LETTA_BASE_URL}/v1/agents/${agent.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      llm_config: {
        handle: 'openai/claude-opus-4-5-20251101',
        model: 'claude-opus-4-5-20251101',
        model_endpoint_type: 'openai',
        model_endpoint: 'http://litellm:4000',
        context_window: 200000,
        temperature: 0.7,
      },
    }),
  });

  if (!updateResponse.ok) {
    console.error('  Failed to update agent to Claude:', await updateResponse.text());
    // Clean up
    await fetch(`${LETTA_BASE_URL}/v1/agents/${agent.id}`, { method: 'DELETE' });
    return false;
  }

  console.log('  Updated agent to use Claude Opus 4.5');

  // Step 3: Send test message
  const messageResponse = await fetch(`${LETTA_BASE_URL}/v1/agents/${agent.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Say "Hello from Claude!" and nothing else.' }],
    }),
  });

  if (!messageResponse.ok) {
    console.error('  Failed to send test message:', await messageResponse.text());
    // Clean up
    await fetch(`${LETTA_BASE_URL}/v1/agents/${agent.id}`, { method: 'DELETE' });
    return false;
  }

  console.log('  Test message sent successfully');

  // Clean up
  await fetch(`${LETTA_BASE_URL}/v1/agents/${agent.id}`, { method: 'DELETE' });
  console.log('  Test agent cleaned up');

  return true;
}

async function main(): Promise<void> {
  console.log('=== Letta Setup Verification ===\n');

  // Check if Letta is running
  try {
    const health = await fetch(`${LETTA_BASE_URL}/v1/health/`);
    if (!health.ok) {
      throw new Error('Letta health check failed');
    }
    console.log('Letta is running.\n');
  } catch {
    console.error('Error: Letta is not accessible at', LETTA_BASE_URL);
    console.error('Make sure to run: docker compose up -d');
    process.exit(1);
  }

  // List available models
  console.log('Available models:');
  const models = await listModels();
  const claudeModels = models.filter((m) => m.handle.includes('claude'));

  for (const model of models) {
    const marker = model.handle.includes('claude') ? ' <-- Claude via LiteLLM' : '';
    console.log(`  - ${model.handle} (${model.provider_name})${marker}`);
  }

  if (claudeModels.length === 0) {
    console.error('\nNo Claude models found. Check OPENAI_API_BASE and LiteLLM configuration.');
    process.exit(1);
  }

  console.log(`\nFound ${claudeModels.length.toString()} Claude model(s) via LiteLLM.\n`);

  // Test agent creation workflow
  const success = await testAgentCreation();

  if (success) {
    console.log('\nSetup verified! You can now run: bun run dev');
  } else {
    console.error('\nSetup verification failed. Check the logs above.');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
