/**
 * Tests for Letta client module
 */

import { test, expect, describe } from "bun:test";
import { getLettaClient } from "./letta";

describe("Letta client", () => {
  test("getLettaClient returns a Letta instance", () => {
    const client = getLettaClient();
    expect(client).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.models).toBeDefined();
    expect(client.tools).toBeDefined();
  });

  test("getLettaClient returns the same instance (singleton)", () => {
    const client1 = getLettaClient();
    const client2 = getLettaClient();
    expect(client1).toBe(client2);
  });
});
