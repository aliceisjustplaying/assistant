/**
 * Integration tests for health check module
 *
 * These tests verify that the health check module integrates
 * correctly with the config module and handles various scenarios.
 */

import { test, expect, describe } from "bun:test";
import { healthCheck, simpleHealthCheck, type HealthCheckResult } from "./health";
import { config } from "./config";

describe("Health Check Integration", () => {
  test("healthCheck uses config values", async () => {
    // Verify that healthCheck is using the config module
    expect(config.LETTA_BASE_URL).toBeDefined();
    expect(config.ANTHROPIC_PROXY_URL).toBeDefined();

    const response = await healthCheck();
    expect(response).toBeDefined();
    expect(response.status).toBeOneOf([200, 503]);
  });

  test("healthCheck returns proper Response object", async () => {
    const response = await healthCheck();

    // Verify it's a valid Response
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    // Verify JSON is parseable
    const body = await response.json();
    expect(body).toBeDefined();
  });

  test("healthCheck has all required checks", async () => {
    const response = await healthCheck();
    const body = (await response.json()) as HealthCheckResult;

    // Verify structure
    expect(body).toHaveProperty("healthy");
    expect(body).toHaveProperty("checks");
    expect(body.checks).toHaveProperty("db");
    expect(body.checks).toHaveProperty("letta");
    expect(body.checks).toHaveProperty("proxy");

    // Verify types
    expect(typeof body.healthy).toBe("boolean");
    expect(typeof body.checks.db).toBe("boolean");
    expect(typeof body.checks.letta).toBe("boolean");
    expect(typeof body.checks.proxy).toBe("boolean");
  });

  test("healthCheck returns 503 when services are down", async () => {
    // In test environment, Letta and Proxy won't be running
    const response = await healthCheck();
    const body = (await response.json()) as HealthCheckResult;

    // Should be unhealthy since services aren't running
    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);

    // DB should be healthy (optional in M0)
    expect(body.checks.db).toBe(true);

    // Letta and Proxy should be unhealthy (not running)
    expect(body.checks.letta).toBe(false);
    expect(body.checks.proxy).toBe(false);
  });

  test("simpleHealthCheck always returns 200", () => {
    const response = simpleHealthCheck();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  test("simpleHealthCheck returns minimal structure", async () => {
    const response = simpleHealthCheck();
    const body = await response.json();

    expect(body.healthy).toBe(true);
    expect(body.checks.server).toBe(true);
    expect(body.message).toContain("M0");
  });
});
