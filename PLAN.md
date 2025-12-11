# ADHD Support Agent - MVP Specification

## 0) Workflow & Tracking

**Issue tracking**: Use `bd` (beads) for all task tracking per CLAUDE.md.

**Step Zero**: Before writing any code, create beads issues for all milestones.

**Environments**:
| Environment | Where | Letta | Anthropic | Telegram |
|-------------|-------|-------|-----------|----------|
| **Dev** | Mac local | Docker (localhost:8283) | anthropic-proxy (localhost:4001) | Polling or ngrok webhook |
| **Prod** | VPS | Docker (same compose) | anthropic-proxy | Real webhook URL |

---

## 1) Scope

- **Single user**, single primary Letta agent
- **Primary value**: reduce overwhelm; capture → structure; tiny-first-step task initiation; quick recall ("what was I doing?"); tiny wins tracking
- **Style**: warm, slightly irreverent "wise friend" - calm underneath with a glint of mischief; co-conspirators against the chaos

---

## 2) Architecture

```
┌──────────┐    webhook    ┌───────────┐    messages    ┌─────────┐
│ Telegram │──────────────▶│    Bun    │───────────────▶│  Letta  │
│          │◀──────────────│  Adapter  │◀───────────────│  Agent  │
└──────────┘               └───────────┘                └─────────┘
                                │                            │
                                │ tool calls                 │
                                ▼                            ▼
                          ┌───────────┐              ┌─────────────┐
                          │  SQLite   │              │  Anthropic  │
                          │  (items)  │              │  via proxy  │
                          └───────────┘              └─────────────┘
```

**Key pattern**: Tool execution runs in **Bun** via a local dispatcher. Letta orchestrates tool calls; our app executes and returns results.

**Runtime flow:**
1. Telegram update (webhook) → normalize + dedupe on `update_id`
2. Send user message to Letta (single-agent context)
3. If Letta requests tool calls → dispatch locally → return tool results
4. Send final assistant message back to Telegram

### Data Flow: Letta Memory ↔ SQLite

```
┌─────────────────────────────────────────────────────────────────┐
│                         LETTA MEMORY                            │
│  (Agent's working memory - what it "knows" in context)          │
│                                                                 │
│  • current_focus: "Working on X because Y, connects to Z"       │
│  • tiny_wins: { today: 3, this_week: 12, streak_days: 2 }       │
│  • open_items: "3 tasks, 1 reminder (summary)"                  │
│  • last_checkpoint: "Was doing X, wandered to Y"                │
│                                                                 │
│  Updated by agent after tool calls. Summaries, not full data.   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ tools bridge the gap
┌─────────────────────────────────────────────────────────────────┐
│                     SQLITE (via Drizzle)                        │
│  (Source of truth - persistent, complete)                       │
│                                                                 │
│  • items: all 500 tasks, notes, reminders                       │
│  • wins: every "said → did" recorded                            │
│  • deviations: every wandering captured                         │
│                                                                 │
│  Tools read/write here. Agent queries when it needs specifics.  │
└─────────────────────────────────────────────────────────────────┘
```

**Why both?**
- SQLite = filing cabinet (everything, permanent)
- Letta memory = what's on your desk (working memory, context-sized summaries)
- Tools = fetching from the cabinet when needed

---

## 3) Directory Layout

```
src/
├── index.ts              # Bootstrap, webhook server, /health
├── config.ts             # Env parsing/validation
├── letta.ts              # Client, provider + agent bootstrap
├── bot.ts                # Telegram handlers → service layer
├── detect.ts             # Overwhelm & self-bullying detection
├── tools/
│   ├── dispatcher.ts     # Routes Letta tool calls to handlers
│   ├── capture.ts        # parse_brain_dump
│   ├── breakdown.ts      # break_down_task
│   ├── context.ts        # set_current_focus, get_open_items, record_deviation
│   ├── items.ts          # save_item, update_item
│   └── wins.ts           # record_tiny_win, get_wins_summary
├── db/
│   ├── index.ts          # Drizzle client (bun:sqlite)
│   ├── schema.ts         # Drizzle schema definitions
│   └── migrations/       # Drizzle migrations (generated)
└── types.ts

drizzle.config.ts         # Drizzle config
docker-compose.yml        # anthropic-proxy + letta + app (with healthchecks)
docker-compose.dev.yml    # Dev overrides (no app container, local volumes)
.env.example
```

---

## 4) Infrastructure

### docker-compose.yml

```yaml
version: '3.8'

networks:
  assistant-net:
    driver: bridge

services:
  anthropic-proxy:
    build:
      context: .
      dockerfile: Dockerfile.anthropic-proxy
    ports:
      - "4001:4001"
    environment:
      - PORT=4001
      - SESSION_SECRET=${ANTHROPIC_PROXY_SESSION_SECRET}
      - CLIENT_ID=9d1c250a-e61b-44d9-88ed-5944d1962f5e
      - REDIRECT_URI=https://console.anthropic.com/oauth/code/callback
      - OAUTH_BASE_URL=https://claude.ai
      - API_BASE_URL=https://api.anthropic.com/v1
    networks:
      - assistant-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  letta:
    image: letta/letta:latest
    ports:
      - "8283:8283"
    environment:
      # OpenAI for embeddings only
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - letta-data:/var/lib/postgresql/data
    networks:
      - assistant-net
    restart: unless-stopped
    depends_on:
      anthropic-proxy:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8283/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - LETTA_BASE_URL=http://letta:8283
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL}
      - TELEGRAM_WEBHOOK_SECRET_TOKEN=${TELEGRAM_WEBHOOK_SECRET_TOKEN}
      - ANTHROPIC_PROXY_URL=http://anthropic-proxy:4001/v1
      - ANTHROPIC_PROXY_SESSION_ID=${ANTHROPIC_PROXY_SESSION_ID}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./data:/app/data  # Persist SQLite database
    networks:
      - assistant-net
    restart: unless-stopped
    depends_on:
      letta:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  letta-data:
```

**Note on Letta + Anthropic**: Letta doesn't use env vars for Anthropic. On first boot, we create an Anthropic provider via API pointing to the proxy:

```typescript
// In src/letta.ts bootstrap
await letta.providers.create({
  name: "anthropic-proxy",
  provider_type: "anthropic",
  api_key: config.ANTHROPIC_PROXY_SESSION_ID,  // Session ID as "key"
  base_url: config.ANTHROPIC_PROXY_URL,        // http://anthropic-proxy:4001/v1
});
```

### Dockerfile.anthropic-proxy

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
# Clone directly - no local context needed
RUN git clone https://github.com/orual/anthropic-proxy.git .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/anthropic-proxy /usr/local/bin/
EXPOSE 4001
CMD ["anthropic-proxy"]
```

---

## 5) Environment Variables

```env
# === Letta ===
LETTA_BASE_URL=http://letta:8283

# === Telegram ===
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_WEBHOOK_SECRET_TOKEN=random-secret-for-verification

# === Anthropic Proxy ===
ANTHROPIC_PROXY_URL=http://anthropic-proxy:4001/v1
ANTHROPIC_PROXY_SESSION_SECRET=random-32-char-string
ANTHROPIC_PROXY_SESSION_ID=  # Filled after OAuth flow

# === OpenAI (embeddings only) ===
OPENAI_API_KEY=your_openai_key

# === Server ===
PORT=3000
```

---

## 6) Agent Persona and Memory Blocks

```typescript
const agent = await client.agents.create({
  name: "adhd-assistant",
  memory_blocks: [
    {
      label: "persona",
      value: `Warm, slightly irreverent companion for someone with ADHD + PDA. Think: trusted friend who's been through it, has perspective, doesn't take the bullshit too seriously.

Vibe:
- Calm underneath, but with a glint of mischief on top
- You're on their side against the chaos - co-conspirators, but grounded ones
- When they're stuck: curious first ("where'd your brain wander?"), then offer to shrink the task or give permission to stop
- Self-bullying gets called out with warmth: "Ah, the inner drill sergeant. They can fuck off. What actually happened?"
- Praise is real and specific, never performative: "You did it. Quietly impressive."
- Celebrate tiny wins without making a big deal: "That's one. Noted."

Language:
- Warm, direct, occasionally wry
- "could/might/want to" not "should/need to/have to"
- Brief by default. Match their energy.
- Can swear lightly if they do. Minimal emoji.

You're their external threading system - steady enough to anchor them, light enough not to weigh them down. You remember what they were doing, why it mattered, and where they wandered off to.

Never:
- Demand, guilt, or pressure
- Claim medical expertise
- Be saccharine, fake-cheerful, or therapist-voiced
- Lecture or moralize`
    },
    {
      label: "human",
      value: "Single user with ADHD + PDA. Values autonomy. Responds well to modest, specific praise. Needs help with overwhelm, task initiation, and working memory. Can be hard on themselves - inner drill sergeant needs to be told to fuck off sometimes."
    },
    {
      label: "preferences",
      value: JSON.stringify({
        praise: true,
        emoji: "minimal",
        response_length: "brief",
        swearing: "light"
      }),
      description: "User preferences for interaction style"
    },
    {
      label: "current_focus",
      value: JSON.stringify({
        task: null,
        why: null,
        connected_to: [],
        started_at: null
      }),
      description: "What user is currently working on, WHY, and what it connects to. Enables threaded context."
    },
    {
      label: "open_items",
      value: "No open items.",
      description: "Summary of tasks/notes/reminders. Updated by item tools."
    },
    {
      label: "last_checkpoint",
      value: JSON.stringify({
        was_doing: null,
        why: null,
        wandered_to: null,
        timestamp: null
      }),
      description: "Threaded recap: what they were doing, why, and where they wandered. For 'what was I doing?' queries."
    },
    {
      label: "tiny_wins",
      value: JSON.stringify({
        today: 0,
        this_week: 0,
        streak_days: 0,
        last_win_at: null
      }),
      description: "Track 'said → did' micro-wins. Builds trust in self over time."
    },
    {
      label: "overwhelm_mode",
      value: JSON.stringify(false),  // Use JSON boolean, not string "false"
      description: "Set to true (JSON.stringify(true)) when overwhelm OR self-bullying detected. Shorten replies, prioritize tiniest step, be extra gentle. Agent should JSON.parse() when reading."
    }
  ],
  model: "anthropic/claude-opus-4-5-20251101",
  embedding: "openai/text-embedding-3-small",
  tools: [
    "parse_brain_dump",
    "break_down_task",
    "set_current_focus",
    "get_open_items",
    "save_item",
    "update_item",
    "record_tiny_win",
    "record_deviation",
    "get_wins_summary"
  ]
});
```

---

## 7) Tools and Dispatcher

### Tool Dispatcher Pattern

```typescript
// src/tools/dispatcher.ts
import { parseCapture } from "./capture";
import { breakdownTask } from "./breakdown";
import { setCurrentFocus, getOpenItems, recordDeviation } from "./context";
import { saveItem, updateItem } from "./items";
import { recordTinyWin, getWinsSummary } from "./wins";

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "parse_brain_dump":
      return parseCapture(args.text as string);
    case "break_down_task":
      return breakdownTask(args.task as string);
    case "set_current_focus":
      return setCurrentFocus(args as SetFocusArgs);
    case "get_open_items":
      return getOpenItems();
    case "save_item":
      return saveItem(args as SaveItemArgs);
    case "update_item":
      return updateItem(args as UpdateItemArgs);
    case "record_tiny_win":
      return recordTinyWin(args as RecordWinArgs);
    case "record_deviation":
      return recordDeviation(args as RecordDeviationArgs);
    case "get_wins_summary":
      return getWinsSummary();
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

### Tool Schemas (registered with Letta)

```typescript
const tools = [
  {
    name: "parse_brain_dump",
    description: "Parse unstructured text into tasks, notes, reminders. Agent may propose due dates.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Unstructured text to parse" }
        },
        required: ["text"]
      }
    }
  },
  {
    name: "break_down_task",
    description: "Break task into tiny steps. First step should be almost embarrassingly small.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task to break down" }
        },
        required: ["task"]
      }
    }
  },
  {
    name: "set_current_focus",
    description: "Update what user is currently working on, WHY it matters, and what it connects to. IMPORTANT: Always try to infer 'why' from context - threading is critical for 'what was I doing?' recall.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "What user is working on" },
          why: { type: "string", description: "Why this matters / what it's for. Infer from context if not explicit." },
          connected_to: { type: "array", items: { type: "string" }, description: "Related tasks/projects this connects to" }
        },
        required: ["task"]  // why/connected_to optional but strongly encouraged
      }
    }
  },
  {
    name: "get_open_items",
    description: "Get all open tasks, notes, and reminders.",
    json_schema: {
      parameters: { type: "object", properties: {} }
    }
  },
  {
    name: "save_item",
    description: "Save a new task, note, or reminder.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["task", "note", "reminder"] },
          content: { type: "string" },
          due_at: { type: "string", description: "ISO date string, optional" }
        },
        required: ["type", "content"]
      }
    }
  },
  {
    name: "update_item",
    description: "Update an existing item's status or content.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          status: { type: "string", enum: ["open", "done", "snoozed", "archived"] },
          content: { type: "string" }
        },
        required: ["id"]
      }
    }
  },
  {
    name: "record_tiny_win",
    description: "Record when user completed something they said they'd do. Builds self-trust over time.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          what: { type: "string", description: "What they accomplished" },
          announced: { type: "boolean", description: "Did they announce it beforehand? (said → did)" }
        },
        required: ["what"]
      }
    }
  },
  {
    name: "record_deviation",
    description: "Non-judgmentally capture where user's attention wandered. For threading context, not shame.",
    json_schema: {
      parameters: {
        type: "object",
        properties: {
          intended: { type: "string", description: "What they were trying to do" },
          wandered_to: { type: "string", description: "Where they ended up" },
          worth_noting: { type: "boolean", description: "Is this deviation worth capturing as a note/insight?" }
        },
        required: ["intended", "wandered_to"]
      }
    }
  },
  {
    name: "get_wins_summary",
    description: "Get summary of tiny wins for encouragement. Use when user doubts themselves.",
    json_schema: {
      parameters: { type: "object", properties: {} }
    }
  }
];
```

### Overwhelm & Self-Bullying Inference

```typescript
// In message handler or tool dispatcher
const OVERWHELM_SIGNALS = [
  /i can'?t/i,
  /too (much|hard|many)/i,
  /overwhelm/i,
  /everything is/i,
  /ugh+/i,
  /stressed/i,
  /stuck/i,
  /can'?t (cope|handle|do)/i
];

const SELF_BULLYING_SIGNALS = [
  /i('m| am) (so )?(lazy|useless|stupid|pathetic|worthless|terrible)/i,
  /what('s| is) wrong with me/i,
  /why (can'?t|am) i/i,
  /i (always|never) /i,
  /i('m| am) (a |the )?(worst|failure|mess|disaster)/i,
  /hate myself/i,
  /i suck/i,
  /can'?t do anything right/i,
  /i('m| am) broken/i,
  /should be able to/i
];

interface DetectionResult {
  overwhelm: boolean;
  selfBullying: boolean;
  triggered: boolean;
}

function detectDistress(text: string): DetectionResult {
  const overwhelm = OVERWHELM_SIGNALS.some(r => r.test(text)) ||
    (text.length > 500 && !text.includes('\n'));

  const selfBullying = SELF_BULLYING_SIGNALS.some(r => r.test(text));

  return {
    overwhelm,
    selfBullying,
    triggered: overwhelm || selfBullying
  };
}
```

**Response strategy:**
- **Overwhelm only**: Shrink task + permission to stop. "That's a lot. Want to pick the tiniest piece, or just... not right now?"
- **Self-bullying only**: Call out the inner critic warmly + redirect. "Ah, the drill sergeant. They can fuck off. What actually happened?"
- **Both**: Acknowledge both, extra gentle, shrink everything. "Hey. That's the mean voice talking AND a lot on your plate. Can we just... pause?"

---

## 8) Telegram Integration

### Webhook Handler

```typescript
// src/index.ts
Bun.serve({
  port: config.PORT,
  fetch: async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return healthCheck();
    }

    if (url.pathname === "/webhook" && req.method === "POST") {
      // Verify secret token
      const secretToken = req.headers.get("x-telegram-bot-api-secret-token");
      if (secretToken !== config.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await req.json();

      // Idempotency: dedupe on update_id
      if (await isDuplicate(update.update_id)) {
        return new Response("OK");
      }

      await handleUpdate(update);
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }
});
```

### Message Handler with Tool Loop

```typescript
// src/bot.ts
import { detectDistress } from "./detect";

async function handleMessage(ctx: Context) {
  const text = ctx.message?.text;
  if (!text) return;

  const userId = ctx.from.id.toString();

  // Check for overwhelm or self-bullying
  const distress = detectDistress(text);

  // Prepend distress context to message if detected (agent will respond appropriately)
  const messageContent = distress.triggered
    ? `[DISTRESS_DETECTED: overwhelm=${distress.overwhelm}, selfBullying=${distress.selfBullying}]\n\n${text}`
    : text;

  // Send to Letta
  let response = await letta.agents.messages.create(agentId, {
    messages: [{ role: "user", content: messageContent }]
  });

  // Tool execution loop
  while (hasToolCalls(response)) {
    const toolResults = await executeToolCalls(response);
    response = await letta.agents.messages.create(agentId, {
      messages: toolResults
    });
  }

  // Extract and send assistant message
  for (const msg of response.messages) {
    if (msg.message_type === "assistant_message") {
      await ctx.reply(msg.content);
    }
  }
}

async function executeToolCalls(response: LettaResponse): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];

  for (const msg of response.messages) {
    if (msg.message_type === "tool_call_message") {
      const result = await dispatchTool(
        msg.tool_call.name,
        JSON.parse(msg.tool_call.arguments)
      );
      results.push({
        role: "tool",
        tool_call_id: msg.tool_call.id,
        content: JSON.stringify(result)
      });
    }
  }

  return results;
}
```

### Telegraf Setup

We use [Telegraf](https://telegraf.js.org/) for Telegram bot framework. Note: Telegraf handles webhook routing internally, but for our custom Bun.serve() setup we extract the update and pass it to Telegraf.

```typescript
// src/bot.ts
import { Telegraf, Markup, Context } from "telegraf";
import { message } from "telegraf/filters";

// Initialize bot (token from env)
export const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// For webhook mode with our custom server:
export async function handleUpdate(update: any) {
  await bot.handleUpdate(update);
}

// Or for dev mode (polling):
export async function startPolling() {
  await bot.launch();
  console.log("Bot started in polling mode");
}

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
```

### Commands and Buttons

```typescript
// /start command
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hey. I'm your external brain - steady when yours is storming.\n\n" +
    "• Dump thoughts and I'll organize them\n" +
    "• Tell me what you're working on (I'll remember why)\n" +
    "• Say 'I did X' and I'll note the win\n" +
    "• Ask 'what was I doing?' when you lose track\n\n" +
    "Or just chat. No pressure.",
    Markup.inlineKeyboard([
      [Markup.button.callback("Dump thoughts", "action:dump")],
      [Markup.button.callback("What's on my plate?", "action:list")],
      [Markup.button.callback("What was I doing?", "action:checkpoint")]
    ])
  );
});

// Handle text messages
bot.on(message("text"), handleMessage);

// Handle button callbacks
bot.action(/^action:(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  // Route to appropriate handler based on action
  await ctx.answerCbQuery();
  // ... handle action
});
```

---

## 9) Database Schema (Drizzle)

### src/db/schema.ts

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Item types and statuses as const for type safety
export const itemTypes = ["task", "note", "reminder"] as const;
export const itemStatuses = ["open", "done", "snoozed", "archived"] as const;

// Items (tasks, notes, reminders)
// Note: tags stored as JSON string, parse/stringify manually
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: itemTypes }).notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: itemStatuses }).default("open"),
  priority: integer("priority"),  // 0-3
  parentId: integer("parent_id").references(() => items.id),
  dueAt: integer("due_at", { mode: "timestamp" }),
  tags: text("tags"),  // JSON string, use JSON.parse/stringify
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  statusIdx: index("idx_items_status").on(table.status),
  dueAtIdx: index("idx_items_due_at").on(table.dueAt),
}));

// Type helper for tags
export type ItemTags = string[];
export const parseTags = (tags: string | null): ItemTags => tags ? JSON.parse(tags) : [];
export const stringifyTags = (tags: ItemTags): string => JSON.stringify(tags);

// Tiny wins (said → did tracking)
export const wins = sqliteTable("wins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  what: text("what").notNull(),
  announced: integer("announced", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  createdAtIdx: index("idx_wins_created_at").on(table.createdAt),
}));

// Deviations (where attention wandered - non-judgmental capture)
export const deviations = sqliteTable("deviations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  intended: text("intended").notNull(),
  wanderedTo: text("wandered_to").notNull(),
  worthNoting: integer("worth_noting", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// User (singleton for debugging/recovery)
export const users = sqliteTable("users", {
  singletonKey: text("singleton_key").primaryKey().default("me"),
  agentId: text("agent_id").notNull(),
  telegramId: text("telegram_id"),
  username: text("username"),
  firstName: text("first_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Idempotency tracking
export const processedUpdates = sqliteTable("processed_updates", {
  updateId: integer("update_id").primaryKey(),
  processedAt: integer("processed_at", { mode: "timestamp" }).notNull(),
});
```

### src/db/index.ts

```typescript
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

// Use data/ directory (mounted volume in Docker)
const DB_PATH = process.env.DB_PATH || "./data/assistant.db";

// Export raw sqlite for health checks
export const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite, { schema });
```

### drizzle.config.ts

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./assistant.db",
  },
} satisfies Config;
```

### Migrations

```bash
# Generate migration after schema changes
bunx drizzle-kit generate

# Apply migrations
bunx drizzle-kit migrate
```

---

## 10) Observability

### Health Check

```typescript
import { db, sqlite } from "./db";

async function healthCheck(): Promise<Response> {
  const checks = {
    db: false,
    letta: false,
    proxy: false
  };

  // DB: Use underlying bun:sqlite directly for simple ping
  try {
    sqlite.query("SELECT 1").get();
    checks.db = true;
  } catch {}

  // Letta: Simple health endpoint, not agents.list() (too slow)
  try {
    const res = await fetch(`${config.LETTA_BASE_URL}/v1/health`);
    checks.letta = res.ok;
  } catch {}

  // Proxy: Check health endpoint
  try {
    const res = await fetch(`${config.ANTHROPIC_PROXY_URL.replace('/v1', '')}/health`);
    checks.proxy = res.ok;
  } catch {}

  const healthy = Object.values(checks).every(Boolean);

  return new Response(JSON.stringify({ healthy, checks }), {
    status: healthy ? 200 : 503,
    headers: { "Content-Type": "application/json" }
  });
}
```

### Structured Logging

```typescript
function log(level: string, message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
    // Redact sensitive data
    ...(data?.text && { text: "[REDACTED]" })
  }));
}
```

### Proxy Error Handling

```typescript
// Backoff + retry on 401/403
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) {
        log("error", "Proxy auth error, may need re-auth", { attempt: i + 1 });
        if (i < retries - 1) {
          await Bun.sleep(delay * Math.pow(2, i));
          continue;
        }
      }
      throw e;
    }
  }
  throw new Error("Max retries exceeded");
}
```

---

## 11) Testing (Minimal for MVP)

```typescript
// tests/tools/capture.test.ts
import { test, expect } from "bun:test";
import { parseCapture } from "../../src/tools/capture";

test("parseCapture extracts tasks", () => {
  const result = parseCapture("buy milk and call mom tomorrow");
  expect(result.items.length).toBeGreaterThan(0);
});

// tests/tools/breakdown.test.ts
test("breakdownTask returns tiniest_first_step", () => {
  const result = breakdownTask("clean the apartment");
  expect(result.tiniest_first_step).toBeDefined();
  expect(result.steps.length).toBeGreaterThan(0);
});

// tests/integration/webhook.test.ts
test("webhook roundtrip with mock Letta", async () => {
  // Mock Letta tool_call response
  // Verify dispatcher executes tool
  // Verify final message sent
});
```

---

## 12) Milestones

| Milestone | Acceptance Criteria |
|-----------|---------------------|
| **M0 Infra** | Compose up; /health OK; providers list OK |
| **M1 E2E Chat** | Webhook works; agent responds; secret verified |
| **M2 Tools + Items** | Brain dump saves items; "what's on my plate?" works; breakdown returns tiny step |
| **M3 Tone + Detection** | Overwhelm + self-bullying detection; appropriate responses; wise friend persona works |
| **M4 Tiny Wins** | "I did X" records win; "by the way I got X Y Z done" works; wins summary available |
| **M5 Threading** | Focus includes why/connected_to; deviations captured; "what was I doing?" includes context |
| **M6 Hardening** | Idempotency works; rate limits; tests passing |

---

## 13) Future (Not MVP)

- **V2 Habits + Momentum**: logs, EMA, graphs
- **V3 Proactive Alerts**: TfL Weaver line; Google Calendar; Gmail
- **V3+ Import/Export**: Notion/Todoist CSV
- Multi-user tenancy
- Additional specialized agents (coding, etc.)

---

## 14) Out of Scope for MVP

- Deletion flows
- Rich tagging UX (agent may auto-tag internally)
- Multi-user tenancy
- Import/export
- External storage beyond SQLite + Letta
