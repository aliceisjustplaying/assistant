/**
 * Wins tools for Letta agents
 *
 * Provides tools for recording and summarizing tiny wins:
 * - record_tiny_win: Record a small accomplishment
 * - delete_tiny_win: Delete a win if recorded by mistake
 * - get_wins_by_day: Get wins for a specific day (today, yesterday, or date)
 * - get_wins_summary: Get a summary of recent wins
 */

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { registerTool, type ToolDefinition } from './dispatcher';

/**
 * Win categories
 */
export type WinCategory = 'task' | 'habit' | 'self_care' | 'social' | 'work' | 'creative' | 'other';

/**
 * Win magnitude levels
 */
export type WinMagnitude = 'tiny' | 'small' | 'medium' | 'big';

/**
 * Arguments for record_tiny_win tool
 */
export interface RecordTinyWinArgs {
  /** What the user accomplished */
  content: string;
  /** Category of the win */
  category?: WinCategory;
  /** How significant the win is */
  magnitude?: WinMagnitude;
}

/**
 * Result from record_tiny_win tool
 */
export interface RecordTinyWinResult {
  /** ID of saved win */
  id: string;
  /** Celebratory message */
  message: string;
  /** Running total of wins today */
  todayCount: number;
}

/**
 * Arguments for delete_tiny_win tool
 */
export interface DeleteTinyWinArgs {
  /** ID of the win to delete */
  id: string;
}

/**
 * Result from delete_tiny_win tool
 */
export interface DeleteTinyWinResult {
  /** Whether deletion was successful */
  success: boolean;
  /** Message describing the result */
  message: string;
  /** The deleted win content (for confirmation) */
  deletedContent?: string;
}

/**
 * Arguments for get_wins_by_day tool
 */
export interface GetWinsByDayArgs {
  /** Period to get wins for: "today", "yesterday", or a specific date in YYYY-MM-DD format */
  period: string;
  /** Filter by category (optional) */
  category?: WinCategory;
}

/**
 * A win with timestamp
 */
export interface WinEntry {
  id: string;
  content: string;
  category: string;
  magnitude: string;
  createdAt: string;
  time: string;
}

/**
 * Result from get_wins_by_day tool
 */
export interface GetWinsByDayResult {
  /** The date being queried (YYYY-MM-DD) */
  date: string;
  /** Human-readable label (e.g., "Today", "Yesterday", "Monday, Dec 9") */
  label: string;
  /** Total wins on this day */
  totalWins: number;
  /** List of wins */
  wins: WinEntry[];
  /** Breakdown by category */
  byCategory: Record<string, number>;
}

/**
 * Arguments for get_wins_summary tool
 */
export interface GetWinsSummaryArgs {
  /** Number of days to look back (default 7) */
  days?: number;
  /** Filter by category (optional) */
  category?: WinCategory;
  /** Maximum number of wins to return */
  limit?: number;
}

/**
 * Result from get_wins_summary tool
 */
export interface GetWinsSummaryResult {
  /** Total wins in period */
  totalWins: number;
  /** Wins grouped by category */
  byCategory: Record<string, number>;
  /** Wins grouped by magnitude */
  byMagnitude: Record<string, number>;
  /** Recent wins list */
  recentWins: {
    id: string;
    content: string;
    category: string;
    magnitude: string;
    createdAt: string;
  }[];
  /** Streak info */
  streak: {
    currentDays: number;
    message: string;
  };
}

/**
 * record_tiny_win tool - Record a small accomplishment
 */
export const recordTinyWinTool: ToolDefinition<RecordTinyWinArgs, RecordTinyWinResult> = registerTool({
  name: 'record_tiny_win',
  description:
    'Record a tiny win or small accomplishment. Use this to celebrate even the smallest victories - getting out of bed, sending an email, drinking water. Every win counts!',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'What the user accomplished (e.g., "Got out of bed", "Replied to that email", "Ate breakfast")',
      },
      category: {
        type: 'string',
        enum: ['task', 'habit', 'self_care', 'social', 'work', 'creative', 'other'],
        description:
          'Category of the win: task (completed something), habit (daily routine), self_care (health/wellness), social (people interaction), work (job related), creative (making things), other',
      },
      magnitude: {
        type: 'string',
        enum: ['tiny', 'small', 'medium', 'big'],
        description:
          'How significant: tiny (just did it), small (took some effort), medium (meaningful achievement), big (major milestone)',
      },
    },
    required: ['content'],
  },
  handler: async (args, context) => {
    const id = crypto.randomUUID();

    // Insert the win
    await db.insert(schema.wins).values({
      id,
      userId: context.userId,
      content: args.content,
      category: args.category ?? 'other',
      magnitude: args.magnitude ?? 'tiny',
    });

    // Count wins today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayWins = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.wins)
      .where(and(eq(schema.wins.userId, context.userId), gte(schema.wins.createdAt, todayStart)));

    const todayCount = todayWins[0]?.count ?? 1;

    // Generate celebratory message based on magnitude and count
    const messages = {
      tiny: ['Nice! Every little step counts!', "That's a win!", 'You did it!'],
      small: ['Good job! Keep that momentum going!', "Well done! You're on a roll!"],
      medium: ['Impressive! That took real effort!', 'Amazing work! You should feel proud!'],
      big: ['WOW! That is a major accomplishment!', "Incredible! You're crushing it!"],
    };

    const magnitude = args.magnitude ?? 'tiny';
    const messageList = messages[magnitude];
    const baseMessage = messageList[Math.floor(Math.random() * messageList.length)] ?? 'Great job!';

    // Add streak bonus message if they have multiple wins today
    let streakBonus = '';
    if (todayCount >= 5) {
      streakBonus = ` You've logged ${String(todayCount)} wins today - you're on fire!`;
    } else if (todayCount >= 3) {
      streakBonus = ` ${String(todayCount)} wins today - great momentum!`;
    }

    return {
      id,
      message: baseMessage + streakBonus,
      todayCount,
    };
  },
});

/**
 * delete_tiny_win tool - Delete a win recorded by mistake
 */
export const deleteTinyWinTool: ToolDefinition<DeleteTinyWinArgs, DeleteTinyWinResult> = registerTool({
  name: 'delete_tiny_win',
  description:
    'Delete a tiny win that was recorded by mistake. Use this if the user wants to remove an incorrectly logged win.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the win to delete (from the wins list)',
      },
    },
    required: ['id'],
  },
  handler: async (args, context) => {
    // First, fetch the win to verify it exists and belongs to this user
    const existing = await db
      .select()
      .from(schema.wins)
      .where(and(eq(schema.wins.id, args.id), eq(schema.wins.userId, context.userId)))
      .limit(1);

    if (existing.length === 0) {
      return {
        success: false,
        message: 'Win not found or you do not have permission to delete it.',
      };
    }

    const win = existing[0];
    if (!win) {
      return {
        success: false,
        message: 'Win not found.',
      };
    }

    // Delete the win
    await db.delete(schema.wins).where(and(eq(schema.wins.id, args.id), eq(schema.wins.userId, context.userId)));

    return {
      success: true,
      message: `Deleted win: "${win.content}"`,
      deletedContent: win.content,
    };
  },
});

/**
 * Helper function to format a date as YYYY-MM-DD in local timezone
 */
function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Helper function to parse period string into date range
 */
function parsePeriodToDateRange(period: string): { start: Date; end: Date; label: string; dateStr: string } {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const periodLower = period.toLowerCase().trim();

  if (periodLower === 'today') {
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    return {
      start: today,
      end,
      label: 'Today',
      dateStr: formatLocalDate(today),
    };
  }

  if (periodLower === 'yesterday') {
    const start = new Date(today);
    start.setDate(start.getDate() - 1);
    return {
      start,
      end: today,
      label: 'Yesterday',
      dateStr: formatLocalDate(start),
    };
  }

  // Try to parse as YYYY-MM-DD (use periodLower for consistent whitespace handling)
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(periodLower);
  if (dateMatch) {
    const start = new Date(periodLower + 'T00:00:00');

    // Validate the date is actually valid (e.g., reject "2024-13-45")
    if (isNaN(start.getTime())) {
      // Invalid date, fall through to default (today)
    } else {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      // Generate human-readable label
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dayOfWeek = dayNames[start.getDay()] ?? '';
      const month = monthNames[start.getMonth()] ?? '';
      const dayNum = start.getDate();

      return {
        start,
        end,
        label: `${dayOfWeek}, ${month} ${String(dayNum)}`,
        dateStr: periodLower,
      };
    }
  }

  // Default to today if invalid
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  return {
    start: today,
    end,
    label: 'Today',
    dateStr: formatLocalDate(today),
  };
}

/**
 * get_wins_by_day tool - Get wins for a specific day
 */
export const getWinsByDayTool: ToolDefinition<GetWinsByDayArgs, GetWinsByDayResult> = registerTool({
  name: 'get_wins_by_day',
  description:
    'Get all wins for a specific day with timestamps. Use "today", "yesterday", or a date in YYYY-MM-DD format.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        description: 'The day to get wins for: "today", "yesterday", or a specific date in YYYY-MM-DD format',
      },
      category: {
        type: 'string',
        enum: ['task', 'habit', 'self_care', 'social', 'work', 'creative', 'other'],
        description: 'Filter by category (optional)',
      },
    },
    required: ['period'],
  },
  handler: async (args, context) => {
    const { start, end, label, dateStr } = parsePeriodToDateRange(args.period);

    // Build where conditions
    const conditions = [
      eq(schema.wins.userId, context.userId),
      gte(schema.wins.createdAt, start),
      lt(schema.wins.createdAt, end),
    ];

    if (args.category) {
      conditions.push(eq(schema.wins.category, args.category));
    }

    // Get wins for this day
    const wins = await db
      .select()
      .from(schema.wins)
      .where(and(...conditions))
      .orderBy(desc(schema.wins.createdAt));

    // Calculate by category
    const byCategory: Record<string, number> = {};
    for (const win of wins) {
      byCategory[win.category] = (byCategory[win.category] ?? 0) + 1;
    }

    // Format wins with time
    const formattedWins: WinEntry[] = wins.map((win) => {
      const time = win.createdAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return {
        id: win.id,
        content: win.content,
        category: win.category,
        magnitude: win.magnitude,
        createdAt: win.createdAt.toISOString(),
        time,
      };
    });

    return {
      date: dateStr,
      label,
      totalWins: wins.length,
      wins: formattedWins,
      byCategory,
    };
  },
});

/**
 * get_wins_summary tool - Get a summary of recent wins
 */
export const getWinsSummaryTool: ToolDefinition<GetWinsSummaryArgs, GetWinsSummaryResult> = registerTool({
  name: 'get_wins_summary',
  description:
    'Get a summary of recent wins to see progress and patterns. Use this to remind the user of their accomplishments when they feel down or need motivation.',
  parameters: {
    type: 'object',
    properties: {
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 30,
        description: 'Number of days to look back (default 7, max 30)',
      },
      category: {
        type: 'string',
        enum: ['task', 'habit', 'self_care', 'social', 'work', 'creative', 'other'],
        description: 'Filter by category (optional)',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of wins to return in the list (default 10, max 50)',
      },
    },
    required: [],
  },
  handler: async (args, context) => {
    const days = args.days ?? 7;
    const limit = args.limit ?? 10;

    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Build where conditions
    const conditions = [eq(schema.wins.userId, context.userId), gte(schema.wins.createdAt, startDate)];

    if (args.category) {
      conditions.push(eq(schema.wins.category, args.category));
    }

    // Get all wins in period
    const wins = await db
      .select()
      .from(schema.wins)
      .where(and(...conditions))
      .orderBy(desc(schema.wins.createdAt));

    // Calculate by category
    const byCategory: Record<string, number> = {};
    const byMagnitude: Record<string, number> = {};

    for (const win of wins) {
      byCategory[win.category] = (byCategory[win.category] ?? 0) + 1;
      byMagnitude[win.magnitude] = (byMagnitude[win.magnitude] ?? 0) + 1;
    }

    // Calculate streak (consecutive days with at least one win)
    const daysWithWins = new Set<string>();
    for (const win of wins) {
      const dateStr = win.createdAt.toISOString().split('T')[0];
      if (dateStr !== undefined && dateStr !== '') {
        daysWithWins.add(dateStr);
      }
    }

    let currentStreak = 0;
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const dateStr = checkDate.toISOString().split('T')[0];
      if (dateStr !== undefined && dateStr !== '' && daysWithWins.has(dateStr)) {
        currentStreak++;
      } else if (i > 0) {
        // Allow today to not have wins yet (they might be adding one now)
        break;
      }
    }

    // Generate streak message
    let streakMessage = 'Start your streak by logging wins each day!';
    if (currentStreak >= 7) {
      streakMessage = `Amazing! ${String(currentStreak)}-day streak! You're building great habits!`;
    } else if (currentStreak >= 3) {
      streakMessage = `Nice ${String(currentStreak)}-day streak going! Keep it up!`;
    } else if (currentStreak >= 1) {
      streakMessage = `${String(currentStreak)} day${currentStreak > 1 ? 's' : ''} with wins - building momentum!`;
    }

    // Format recent wins
    const recentWins = wins.slice(0, limit).map((win) => ({
      id: win.id,
      content: win.content,
      category: win.category,
      magnitude: win.magnitude,
      createdAt: win.createdAt.toISOString(),
    }));

    return {
      totalWins: wins.length,
      byCategory,
      byMagnitude,
      recentWins,
      streak: {
        currentDays: currentStreak,
        message: streakMessage,
      },
    };
  },
});
