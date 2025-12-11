/**
 * Integration tests for health check module
 *
 * These tests verify that the health check module integrates
 * correctly with the config module and handles various scenarios.
 */

import { test, expect, describe } from 'bun:test';
import { healthCheck, simpleHealthCheck, type HealthCheckResult } from './health';
import { config } from './config';

describe('Health Check Integration', () => {
  test('healthCheck uses config values', async () => {
    // Verify that healthCheck is using the config module
    expect(config.LETTA_BASE_URL).toBeDefined();
    expect(config.LITELLM_URL).toBeDefined();

    const response = await healthCheck();
    expect(response).toBeDefined();
    expect(response.status).toBeOneOf([200, 503]);
  });

  test('healthCheck returns proper Response object', async () => {
    const response = await healthCheck();

    // Verify it's a valid Response
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    // Verify JSON is parseable
    const body = await response.json();
    expect(body).toBeDefined();
  });

  test('healthCheck has all required checks', async () => {
    const response = await healthCheck();
    const body = (await response.json()) as HealthCheckResult;

    // Verify structure
    expect(body).toHaveProperty('healthy');
    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('db');
    expect(body.checks).toHaveProperty('letta');
    expect(body.checks).toHaveProperty('litellm');

    // Verify types
    expect(typeof body.healthy).toBe('boolean');
    expect(typeof body.checks.db).toBe('boolean');
    expect(typeof body.checks.letta).toBe('boolean');
    expect(typeof body.checks.litellm).toBe('boolean');
  });

  test('healthCheck status matches healthy field', async () => {
    // This integration test verifies consistency between status code and healthy field
    // Services may or may not be running depending on the environment
    const response = await healthCheck();
    const body = (await response.json()) as HealthCheckResult;

    // DB should always be healthy in M0 (check is skipped)
    expect(body.checks.db).toBe(true);

    // Status code should be consistent with healthy field
    if (body.healthy) {
      expect(response.status).toBe(200);
      // All checks should be true when healthy
      expect(body.checks.letta).toBe(true);
      expect(body.checks.litellm).toBe(true);
    } else {
      expect(response.status).toBe(503);
      // At least one check should be false when unhealthy
      const anyFailed = !body.checks.letta || !body.checks.litellm;
      expect(anyFailed).toBe(true);
    }
  });

  test('simpleHealthCheck always returns 200', () => {
    const response = simpleHealthCheck();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  test('simpleHealthCheck returns minimal structure', async () => {
    const response = simpleHealthCheck();
    const body = (await response.json()) as { healthy: boolean; checks: { server: boolean }; message: string };

    expect(body.healthy).toBe(true);
    expect(body.checks.server).toBe(true);
    expect(body.message).toContain('M0');
  });
});
