import { expect, test } from 'bun:test';

import { formatDetectionContext, type DetectionResult } from './detect';

test('formatDetectionContext returns empty string when not triggered', () => {
  const result: DetectionResult = {
    triggered: false,
    overwhelm: false,
    brainDump: false,
    selfBullying: false,
    urgency: 'low',
  };

  expect(formatDetectionContext(result)).toBe('');
});

test('formatDetectionContext returns empty string when triggered but no flags or parsed data', () => {
  const result: DetectionResult = {
    triggered: true,
    overwhelm: false,
    brainDump: false,
    selfBullying: false,
    urgency: 'low',
  };

  expect(formatDetectionContext(result)).toBe('');
});

test('formatDetectionContext includes flags and parsed tasks', () => {
  const result: DetectionResult = {
    triggered: true,
    overwhelm: false,
    brainDump: true,
    selfBullying: false,
    urgency: 'medium',
    parsed: {
      tasks: [{ content: 'Call the dentist', priority: 2 }],
      ideas: [{ content: 'Try a standing desk' }],
      savedTaskIds: ['task-1'],
      savedIdeaIds: ['idea-1'],
    },
  };

  const context = formatDetectionContext(result);
  expect(context).toContain('[DETECTED: brain_dump=true, urgency=medium]');
  expect(context).toContain('[PARSED & SAVED: 1 tasks, 1 ideas]');
  expect(context).toContain('- Call the dentist');
});
