/**
 * Letta client and provider bootstrap module
 *
 * Provides:
 * - Singleton Letta client instance
 * - Anthropic provider creation/management
 * - Agent creation (placeholder for M1)
 */

import { Letta } from "@letta-ai/letta-client";
import { config } from "./config";

/**
 * Singleton Letta client instance
 */
let lettaClient: Letta | null = null;

/**
 * Get or create the Letta client singleton
 */
export function getLettaClient(): Letta {
  if (!lettaClient) {
    lettaClient = new Letta({
      baseUrl: config.LETTA_BASE_URL,
    });
  }
  return lettaClient;
}

/**
 * Ensure the Anthropic provider is configured
 *
 * NOTE: The current @letta-ai/letta-client SDK (v1.3.3) doesn't expose a
 * `providers` API. Models are specified directly in the agent configuration
 * using the format "provider/model-name" (e.g., "anthropic/claude-opus-4-5-20251101").
 *
 * This function verifies Letta connectivity by listing available models.
 * Provider configuration (API keys, base URLs) is handled via environment
 * variables or Letta's server configuration, not the client SDK.
 *
 * For the anthropic-proxy setup:
 * - The proxy should be configured as an Anthropic provider in Letta server
 * - This is typically done via Letta's admin interface or configuration files
 * - The client SDK just references models by their provider/name handle
 *
 * @returns A status message
 */
export async function ensureProvider(): Promise<string> {
  const client = getLettaClient();

  try {
    console.log("Verifying Letta connectivity...");

    // List available models to verify connectivity
    const models = await client.models.list();
    console.log(`Letta is accessible. Found ${models.llm_models?.length || 0} LLM models and ${models.embedding_models?.length || 0} embedding models.`);

    // Log available Anthropic models
    const anthropicModels = models.llm_models?.filter((m: any) =>
      m.provider_type === "anthropic" || m.provider_name?.includes("anthropic")
    ) || [];

    if (anthropicModels.length > 0) {
      console.log(`Found ${anthropicModels.length} Anthropic model(s):`);
      anthropicModels.forEach((m: any) => {
        console.log(`  - ${m.handle || m.name}`);
      });
    } else {
      console.warn(
        "⚠️  No Anthropic models found. " +
        "Make sure the anthropic-proxy is configured as a provider in Letta server. " +
        "This may need to be done via Letta's admin interface or configuration."
      );
    }

    return "Letta connectivity verified";
  } catch (error: any) {
    console.error("Failed to verify Letta connectivity:", error);
    throw error;
  }
}

/**
 * Get or create the ADHD assistant agent
 *
 * This is a placeholder for M1 implementation.
 * For now, it just logs a message and returns null.
 *
 * @returns Agent ID once implemented, null for now
 */
export async function getOrCreateAgent(): Promise<string | null> {
  console.log("getOrCreateAgent() called - placeholder for M1 implementation");
  console.log("Agent creation will be implemented in milestone M1");
  return null;
}

/**
 * Initialize Letta on application startup
 *
 * - Creates the Letta client
 * - Ensures the anthropic-proxy provider exists
 * - Eventually will create/get the agent (M1)
 */
export async function initializeLetta(): Promise<void> {
  console.log("Initializing Letta...");

  // Get client (creates singleton)
  const client = getLettaClient();
  console.log(`Letta client initialized (base URL: ${config.LETTA_BASE_URL})`);

  // Ensure provider exists
  try {
    await ensureProvider();
  } catch (error) {
    console.error("Failed to ensure provider during initialization:", error);
    throw error;
  }

  // Placeholder: agent creation will be added in M1
  console.log("Letta initialization complete (agent creation deferred to M1)");
}
