/**
 * Haiku-based message detection for overwhelm, brain dumps, and self-bullying
 *
 * Flow:
 * 1. Quick regex pre-filter to decide if Haiku classification is needed
 * 2. If triggered, call Haiku 4.5 for comprehensive classification
 * 3. If brain dump detected, parse in parallel and save to DB
 * 4. Return results for Opus to respond with full context
 */

import { config } from './config';
import { db, schema } from './db';

/**
 * Classification result from Haiku
 */
export interface DetectionResult {
  /** Whether detection was triggered and run */
  triggered: boolean;
  /** User is feeling overwhelmed/stuck */
  overwhelm: boolean;
  /** Stream of consciousness needing structure */
  brainDump: boolean;
  /** User being hard on themselves */
  selfBullying: boolean;
  /** Urgency level */
  urgency: 'low' | 'medium' | 'high';
  /** If brain dump was parsed, the extracted items */
  parsed?: {
    tasks: { content: string; priority: number }[];
    ideas: { content: string }[];
    savedTaskIds: string[];
    savedIdeaIds: string[];
  };
  /** Raw classification reasoning (for debugging) */
  reasoning?: string;
}

/**
 * Regex patterns that trigger Haiku classification
 *
 * These are intentionally broad - Haiku does the nuanced analysis
 */
const TRIGGER_PATTERNS = [
  // Overwhelm signals
  /overwhelm/i,
  /too much/i,
  /can'?t (cope|handle|deal|do this)/i,
  /stressed/i,
  /stuck/i,
  /everything is/i,
  /drowning/i,
  /falling behind/i,

  // Brain dump signals
  /brain\s*dump/i,
  /dump/i,
  /everything.*(head|mind)/i,
  /get.*(out|down).*(head|mind)/i,
  /list of/i,
  /bunch of/i,
  /need to.*need to.*need to/i, // Multiple "need to" in one message

  // Self-bullying signals
  /i('m| am) (so )?(lazy|useless|stupid|pathetic|worthless|terrible)/i,
  /what('s| is) wrong with me/i,
  /why (can'?t|don'?t) i/i,
  /i (always|never) /i,
  /i('m| am) (a |the )?(worst|failure|mess|disaster)/i,
  /hate myself/i,
  /i suck/i,
  /should be able to/i,
  /can'?t do anything right/i,
  /i('m| am) broken/i,

  // Long messages often indicate brain dumps
  // (checked separately by length)
];

/**
 * Quick pre-filter to decide if Haiku should be called
 *
 * @param text - User message
 * @returns true if Haiku classification should run
 */
export function shouldTriggerDetection(text: string): boolean {
  // Long messages (>300 chars without line breaks) suggest brain dump
  if (text.length > 300 && !text.includes('\n')) {
    return true;
  }

  // Multiple sentences with task-like content
  if (text.length > 150 && (text.match(/\./g)?.length ?? 0) >= 3) {
    return true;
  }

  // Check regex patterns
  return TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Call Haiku 4.5 via LiteLLM to classify the message
 */
async function classifyWithHaiku(text: string): Promise<{
  overwhelm: boolean;
  brainDump: boolean;
  selfBullying: boolean;
  urgency: 'low' | 'medium' | 'high';
  reasoning: string;
}> {
  const systemPrompt = `You are a message classifier for an ADHD support assistant. Analyze the user's message and classify it.

Return ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "overwhelm": boolean,      // User feels stuck, can't cope, too much on plate
  "brainDump": boolean,      // Stream of consciousness, list of thoughts/tasks needing structure
  "selfBullying": boolean,   // Negative self-talk, being hard on themselves, inner critic
  "urgency": "low|medium|high",  // How urgent does this feel for the user
  "reasoning": "brief explanation"
}

Guidelines:
- overwhelm: Look for words like "can't", "too much", "stuck", "drowning", emotional exhaustion
- brainDump: Multiple tasks/thoughts listed, stream of consciousness, "need to X, need to Y, also Z"
- selfBullying: "I'm so lazy", "what's wrong with me", "I always fail", harsh self-judgment
- urgency: high = crisis/distress, medium = needs help soon, low = casual/informational

Be generous with detection - it's better to offer support than miss someone struggling.`;

  const response = await fetch(`${config.LITELLM_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.HAIKU_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1, // Low temperature for consistent classification
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Haiku classification failed: ${String(response.status)} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  const firstChoice = data.choices[0];
  const content = firstChoice?.message.content ?? '{}';

  try {
    // Parse the JSON response, handling potential markdown code blocks
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as {
      overwhelm?: boolean;
      brainDump?: boolean;
      selfBullying?: boolean;
      urgency?: string;
      reasoning?: string;
    };

    return {
      overwhelm: parsed.overwhelm === true,
      brainDump: parsed.brainDump === true,
      selfBullying: parsed.selfBullying === true,
      urgency: (['low', 'medium', 'high'].includes(parsed.urgency ?? '') ? parsed.urgency : 'low') as
        | 'low'
        | 'medium'
        | 'high',
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    console.warn('Failed to parse Haiku classification response:', content);
    // Default to safe values if parsing fails
    return {
      overwhelm: false,
      brainDump: false,
      selfBullying: false,
      urgency: 'low',
      reasoning: 'Parse error',
    };
  }
}

/**
 * Parse a brain dump using Haiku to extract tasks and ideas
 */
async function parseBrainDumpWithHaiku(text: string): Promise<{
  tasks: { content: string; priority: number }[];
  ideas: { content: string }[];
}> {
  const systemPrompt = `You are a brain dump parser for an ADHD support assistant. Extract actionable tasks and ideas from the user's stream of consciousness.

Return ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "tasks": [
    {"content": "task description", "priority": 2}
  ],
  "ideas": [
    {"content": "idea or thought to save"}
  ]
}

Guidelines:
- tasks: Actionable items with clear verbs (call, email, buy, fix, finish, etc.)
- ideas: Thoughts, notes, things to remember that aren't actionable yet
- priority: 0=critical, 1=high, 2=medium (default), 3=low, 4=backlog
- Keep task descriptions concise but complete
- Extract the essence, don't just copy text verbatim
- If something could be both, prefer task over idea
- Infer priority from context (urgent language = higher priority)`;

  const response = await fetch(`${config.LITELLM_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.HAIKU_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Haiku brain dump parsing failed: ${String(response.status)} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  const firstChoice = data.choices[0];
  const content = firstChoice?.message.content ?? '{}';

  try {
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as {
      tasks?: { content: string; priority?: number }[];
      ideas?: { content: string }[];
    };

    return {
      tasks: (parsed.tasks ?? []).map((t) => ({
        content: t.content,
        priority: typeof t.priority === 'number' ? t.priority : 2,
      })),
      ideas: parsed.ideas ?? [],
    };
  } catch {
    console.warn('Failed to parse brain dump response:', content);
    return { tasks: [], ideas: [] };
  }
}

/**
 * Save parsed brain dump items to database
 */
async function saveParsedItems(
  userId: number,
  tasks: { content: string; priority: number }[],
  ideas: { content: string }[]
): Promise<{ taskIds: string[]; ideaIds: string[] }> {
  const taskIds: string[] = [];
  const ideaIds: string[] = [];

  // Save tasks
  for (const task of tasks) {
    const id = crypto.randomUUID();
    await db.insert(schema.items).values({
      id,
      userId,
      type: 'task',
      content: task.content,
      status: 'open',
      priority: task.priority,
      parentId: null,
    });
    taskIds.push(id);
  }

  // Save ideas as brain_dump items
  for (const idea of ideas) {
    const id = crypto.randomUUID();
    await db.insert(schema.items).values({
      id,
      userId,
      type: 'brain_dump',
      content: idea.content,
      status: 'open',
      priority: 3, // Low priority for ideas
      parentId: null,
    });
    ideaIds.push(id);
  }

  return { taskIds, ideaIds };
}

/**
 * Main detection function - classifies message and optionally parses brain dumps
 *
 * @param text - User message
 * @param userId - Telegram user ID for saving parsed items
 * @returns Detection result with classification and any parsed items
 */
export async function detectAndParse(text: string, userId: number): Promise<DetectionResult> {
  // Quick pre-filter
  if (!shouldTriggerDetection(text)) {
    return {
      triggered: false,
      overwhelm: false,
      brainDump: false,
      selfBullying: false,
      urgency: 'low',
    };
  }

  console.log('Detection triggered, calling Haiku for classification...');

  try {
    // Step 1: Classify with Haiku
    const classification = await classifyWithHaiku(text);

    console.log('Haiku classification:', classification);

    const result: DetectionResult = {
      triggered: true,
      ...classification,
    };

    // Step 2: If brain dump detected, parse and save in parallel
    if (classification.brainDump) {
      console.log('Brain dump detected, parsing with Haiku...');

      const { tasks, ideas } = await parseBrainDumpWithHaiku(text);

      if (tasks.length > 0 || ideas.length > 0) {
        const { taskIds, ideaIds } = await saveParsedItems(userId, tasks, ideas);

        result.parsed = {
          tasks,
          ideas,
          savedTaskIds: taskIds,
          savedIdeaIds: ideaIds,
        };

        console.log(`Parsed brain dump: ${String(tasks.length)} tasks, ${String(ideas.length)} ideas saved`);
      }
    }

    return result;
  } catch (error) {
    console.error('Detection error:', error);
    // On error, return safe defaults but mark as triggered so we know something happened
    return {
      triggered: true,
      overwhelm: false,
      brainDump: false,
      selfBullying: false,
      urgency: 'low',
      reasoning: `Detection error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

/**
 * Format detection result as context prefix for Opus
 *
 * @param result - Detection result
 * @returns Formatted string to prepend to user message
 */
export function formatDetectionContext(result: DetectionResult): string {
  if (!result.triggered) {
    return '';
  }

  const flags: string[] = [];

  if (result.overwhelm) {
    flags.push('overwhelm=true');
  }
  if (result.brainDump) {
    flags.push('brain_dump=true');
  }
  if (result.selfBullying) {
    flags.push('self_bullying=true');
  }
  if (result.urgency !== 'low') {
    flags.push(`urgency=${result.urgency}`);
  }

  let context = `[DETECTED: ${flags.join(', ')}]`;

  if (result.parsed) {
    const { tasks, ideas } = result.parsed;
    context += `\n[PARSED & SAVED: ${String(tasks.length)} tasks, ${String(ideas.length)} ideas]`;

    // Include task summaries for Opus to reference
    if (tasks.length > 0) {
      const taskList = tasks.map((t) => `- ${t.content}`).join('\n');
      context += `\n[TASKS:\n${taskList}]`;
    }
  }

  return context + '\n\n';
}
