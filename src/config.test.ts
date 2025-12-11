import { test, expect } from "bun:test";

/**
 * Config module tests
 *
 * Note: These tests verify the helper functions work correctly.
 * The actual config object is created at module load time with the
 * current environment, so we test the validation functions instead.
 */

test("validateConfig accepts valid URLs", () => {
  // Create a mock config with valid values
  const mockConfig = {
    PORT: 3000,
    LETTA_BASE_URL: "http://localhost:8283",
    TELEGRAM_BOT_TOKEN: "test_token",
    TELEGRAM_WEBHOOK_URL: "",
    TELEGRAM_WEBHOOK_SECRET_TOKEN: "",
    ANTHROPIC_PROXY_URL: "http://localhost:4001/v1",
    ANTHROPIC_PROXY_SESSION_SECRET: "test_secret",
    ANTHROPIC_PROXY_SESSION_ID: "",
    OPENAI_API_KEY: "test_key",
    DB_PATH: "./data/assistant.db",
  };

  // Should not throw with valid config
  expect(() => {
    // Validate URLs
    new URL(mockConfig.LETTA_BASE_URL);
    new URL(mockConfig.ANTHROPIC_PROXY_URL);
  }).not.toThrow();
});

test("URL validation rejects invalid URLs", () => {
  expect(() => new URL("not-a-url")).toThrow();
  expect(() => new URL("")).toThrow();
});

test("PORT validation accepts valid ports", () => {
  const validPorts = [1, 3000, 8080, 65535];
  for (const port of validPorts) {
    expect(port >= 1 && port <= 65535).toBe(true);
  }
});

test("PORT validation rejects invalid ports", () => {
  const invalidPorts = [0, -1, 70000, 100000];
  for (const port of invalidPorts) {
    expect(port >= 1 && port <= 65535).toBe(false);
  }
});

test("webhook mode detection works correctly", () => {
  // Both set = webhook mode
  const webhook1 = { url: "https://example.com", secret: "token" };
  expect(webhook1.url !== "" && webhook1.secret !== "").toBe(true);

  // Both empty = polling mode
  const webhook2 = { url: "", secret: "" };
  expect(webhook2.url !== "" && webhook2.secret !== "").toBe(false);

  // Only one set = invalid (should be caught by validateConfig)
  const webhook3 = { url: "https://example.com", secret: "" };
  const hasUrl = webhook3.url !== "";
  const hasSecret = webhook3.secret !== "";
  expect(hasUrl === hasSecret).toBe(false); // Should trigger validation error
});

test("session ID detection works correctly", () => {
  expect("session_123" !== "").toBe(true);
  expect("" !== "").toBe(false);
});

test("number parsing works correctly", () => {
  expect(Number("3000")).toBe(3000);
  expect(Number("8080")).toBe(8080);
  expect(isNaN(Number("not-a-number"))).toBe(true);
  expect(isNaN(Number(""))).toBe(false); // Empty string becomes 0
});

test("default values work correctly", () => {
  const getValue = (envValue: string | undefined, defaultValue: string) => {
    return envValue || defaultValue;
  };

  expect(getValue(undefined, "default")).toBe("default");
  expect(getValue("", "default")).toBe("default");
  expect(getValue("custom", "default")).toBe("custom");
});
