---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**
```bash
bd ready --json
```

**Create new issues:**
```bash
bd create "Issue title" -t bug|feature|task -p 0-4 --json
bd create "Issue title" -p 1 --deps discovered-from:bd-123 --json
bd create "Subtask" --parent <epic-id> --json  # Hierarchical subtask (gets ID like epic-id.1)
```

**Claim and update:**
```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**
```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`
6. **Commit together**: Always commit the `.beads/issues.jsonl` file together with the code changes so issue state stays in sync with code state

### Auto-Sync

bd automatically syncs with git:
- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Managing AI-Generated Planning Documents

AI assistants often create planning and design documents during development:
- PLAN.md, IMPLEMENTATION.md, ARCHITECTURE.md
- DESIGN.md, CODEBASE_SUMMARY.md, INTEGRATION_PLAN.md
- TESTING_GUIDE.md, TECHNICAL_DESIGN.md, and similar files

**Best Practice: Use a dedicated directory for these ephemeral files**

**Recommended approach:**
- Create a `history/` directory in the project root
- Store ALL AI-generated planning/design docs in `history/`
- Keep the repository root clean and focused on permanent project files
- Only access `history/` when explicitly asked to review past planning

### CLI Help

Run `bd <command> --help` to see all available flags for any command.
For example: `bd create --help` shows `--parent`, `--deps`, `--assignee`, etc.

### Important Rules

- Use bd for ALL task tracking
- Always use `--json` flag for programmatic use
- Link discovered work with `discovered-from` dependencies
- Check `bd ready` before asking "what should I work on?"
- Store AI planning docs in `history/` directory
- Run `bd <cmd> --help` to discover available flags
- Do NOT create markdown TODO lists
- Do NOT use external issue trackers
- Do NOT duplicate tracking systems
- Do NOT clutter repo root with planning documents

---

## Claude Models

This project uses **two Claude models**:

### Opus 4.5 (Main Agent)
- Model ID: `claude-opus-4-5-20251101`
- Letta handle: `openai/claude-opus-4-5-20251101` (via LiteLLM proxy)
- Used for: Main conversational agent, tool execution, user interactions

### Haiku 4.5 (Detection)
- Model ID: `claude-haiku-4-5-20251001`
- Config: `HAIKU_MODEL` environment variable
- Used for: Fast classification of user messages (overwhelm, brain dump, self-bullying)
- Called via LiteLLM at `LITELLM_URL`

The detection flow in `src/detect.ts`:
1. Regex pre-filter triggers Haiku only when patterns detected
2. Haiku classifies: `overwhelm`, `brainDump`, `selfBullying`, `urgency`
3. If brain dump detected, Haiku parses and saves tasks/ideas to DB
4. Detection context prepended to message for Opus to respond appropriately

Do NOT use Sonnet unless explicitly requested.

### Letta Agent Creation Workaround

Due to a Letta bug with BYOK model handles, agents must be created in two steps:

1. Create agent with `letta/letta-free` model
2. Update agent's `llm_config` to use Claude:
   ```typescript
   await client.agents.update(agentId, {
     llm_config: {
       handle: 'openai/claude-opus-4-5-20251101',
       model: 'claude-opus-4-5-20251101',
       model_endpoint_type: 'openai',
       model_endpoint: 'http://litellm:4000',
       context_window: 200000,
       temperature: 0.7,
     },
   });
   ```

### Letta Tool Registration (Critical!)

Custom tools require careful registration. Letta's "auto-extraction from Python source" is unreliable.

**1. json_schema format** - Use Letta's flat format, NOT OpenAI's nested format:
```typescript
// WRONG (OpenAI format)
json_schema: {
  type: 'function',
  function: { name, description, parameters }
}

// CORRECT (Letta format)
json_schema: {
  name: 'tool_name',
  description: 'What it does',
  parameters: {
    type: 'object',
    properties: { /* ... */ },
    required: ['arg1']
  }
}
```

**2. Always pass json_schema explicitly** - Both on create AND update:
```typescript
// When creating
await client.tools.create({
  source_code: pythonCode,
  description: '...',
  json_schema: { name, description, parameters },  // Required!
});

// When updating existing tools
await client.tools.update(toolId, {
  source_code: pythonCode,
  description: '...',
  json_schema: { name, description, parameters },  // Also required!
});
```

**3. Python function signatures** - Use explicit typed parameters:
```python
# WRONG - Letta won't know what args to pass
def my_tool(**kwargs):
    pass

# CORRECT - Explicit parameters
def my_tool(text: str, priority: int = None):
    pass
```

**4. Tool attachment timing** - Attach AFTER agent creation:
```typescript
// Tools must be attached after agent is created
// (tool_ids in create() doesn't work with letta-free)
const agent = await client.agents.create({ /* ... */ });
for (const toolId of toolIds) {
  await client.agents.tools.attach(toolId, { agent_id: agent.id });
}
```

**5. Handle existing tools** - Check by name and update instead of failing:
```typescript
const existingTools = new Map<string, string>();
for await (const tool of client.tools.list()) {
  existingTools.set(tool.name, tool.id);
}
// Then update if exists, create if not
```

---

## Tiny Wins Tools

The bot includes tools for tracking small accomplishments in `src/tools/wins.ts`:

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `record_tiny_win` | Log an accomplishment | `content` (required), `category`, `magnitude` |
| `delete_tiny_win` | Remove a mistaken entry | `id` (required) |
| `get_wins_by_day` | Query wins for a specific day | `period` ("today", "yesterday", "YYYY-MM-DD"), `category` |
| `get_wins_summary` | Get overview with streaks | `days` (1-30), `category`, `limit` |

**Categories:** `task`, `habit`, `self_care`, `social`, `work`, `creative`, `other`

**Magnitudes:** `tiny`, `small`, `medium`, `big`

**Database:** Wins are stored in the `wins` table with timestamps (`createdAt`).

---

## Code Quality (MANDATORY)

**CRITICAL**: All code changes MUST pass these checks before completion:

```bash
bun run check  # Runs all checks: typecheck, lint, format, test
```

### Individual Commands

```bash
bun run typecheck    # TypeScript strict checking with tsgo
bun run lint         # ESLint with strict rules
bun run format:check # Prettier format verification
bun test             # Run all tests
```

### Auto-fix Commands

```bash
bun run fix          # Auto-fix lint and format issues
bun run lint:fix     # Fix ESLint issues only
bun run format       # Fix Prettier issues only
```

### Subagent Handoff Protocol

**Before completing ANY task**, subagents MUST:

1. Run `bun run check` and ensure ALL checks pass
2. Fix any errors found (use `bun run fix` for auto-fixable issues)
3. Re-run `bun run check` to verify fixes
4. Only mark task complete when all checks pass

**If checks fail and cannot be fixed:**
- Document the specific errors in the task completion message
- Do NOT mark task as complete
- Escalate to orchestrator for resolution

### Configuration Files

- `tsconfig.json` - Strict TypeScript (all strict flags enabled)
- `eslint.config.js` - ESLint flat config with typescript-eslint strict
- `.prettierrc` - Prettier (120 chars, semicolons, single quotes)

---

## Bun Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

