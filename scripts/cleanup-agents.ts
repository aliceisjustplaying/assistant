/**
 * Cleanup script to delete old/stale agents from Letta
 *
 * Usage:
 *   bun run scripts/cleanup-agents.ts           # List agents (dry run)
 *   bun run scripts/cleanup-agents.ts --delete  # Delete all except 'adhd-support-agent'
 */

import { Letta } from '@letta-ai/letta-client';

const LETTA_BASE_URL = process.env['LETTA_BASE_URL'] ?? 'http://localhost:8283';
const KEEP_AGENT_NAME = 'adhd-support-agent';

async function main() {
  const deleteMode = process.argv.includes('--delete');

  console.log(`Connecting to Letta at ${LETTA_BASE_URL}...`);
  const client = new Letta({ baseURL: LETTA_BASE_URL });

  const agents: { id: string; name: string | null; createdAt: Date | null }[] = [];

  console.log('Fetching agents...\n');
  for await (const agent of client.agents.list()) {
    agents.push({
      id: agent.id,
      name: agent.name,
      createdAt: agent.created_at,
    });
  }

  console.log(`Found ${String(agents.length)} agent(s):\n`);

  const toDelete: string[] = [];
  const toKeep: string[] = [];

  for (const agent of agents) {
    const name = agent.name ?? '(unnamed)';
    const createdRaw = agent.createdAt;
    const created = typeof createdRaw === 'string' ? createdRaw.slice(0, 16) : 'unknown';

    if (agent.name === KEEP_AGENT_NAME) {
      console.log(`  ✓ KEEP: ${name} (${agent.id.slice(0, 12)}...) - ${created}`);
      toKeep.push(agent.id);
    } else {
      console.log(`  ✗ DELETE: ${name} (${agent.id.slice(0, 12)}...) - ${created}`);
      toDelete.push(agent.id);
    }
  }

  console.log(`\nSummary: ${String(toKeep.length)} to keep, ${String(toDelete.length)} to delete`);

  if (toDelete.length === 0) {
    console.log('\nNothing to delete!');
    return;
  }

  if (!deleteMode) {
    console.log('\nDry run - no agents deleted. Run with --delete to actually delete.');
    return;
  }

  console.log('\nDeleting agents...');
  for (const id of toDelete) {
    try {
      await client.agents.delete(id);
      console.log(`  Deleted: ${id}`);
    } catch (err) {
      console.error(`  Failed to delete ${id}:`, err);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
