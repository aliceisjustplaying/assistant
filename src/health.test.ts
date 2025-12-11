/**
 * Tests for health check functionality
 */

import { test, expect, describe } from 'bun:test';
import { simpleHealthCheck } from './health';

describe('Health Check', () => {
  test('simpleHealthCheck returns 200 and healthy status', async () => {
    const response = simpleHealthCheck();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const body = (await response.json()) as { healthy: boolean; checks: { server: boolean } };
    expect(body.healthy).toBe(true);
    expect(body.checks.server).toBe(true);
  });

  test('simpleHealthCheck returns valid JSON', async () => {
    const response = simpleHealthCheck();
    const body = (await response.json()) as { healthy: boolean; checks: Record<string, boolean> };

    expect(body).toHaveProperty('healthy');
    expect(body).toHaveProperty('checks');
    expect(typeof body.healthy).toBe('boolean');
  });
});
