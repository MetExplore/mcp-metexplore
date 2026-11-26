// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import type { Config } from "../src/config.js";

const config: Config = {
  apiUrl: "http://localhost:1337",
  appKey: "app-key",
  maxRequestsPerSession: 20,
  tlsRejectUnauthorized: true,
};

test("every tool is annotated as read-only and non-destructive in tools/list", async () => {
  const { server } = createMcpServer(config, "stdio");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotations-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name}: readOnlyHint`);
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name}: destructiveHint`);
      assert.equal(typeof tool.annotations?.openWorldHint, "boolean", `${tool.name}: openWorldHint`);
    }
    const quota = tools.find((t) => t.name === "get_quota_status");
    assert.equal(quota?.annotations?.openWorldHint, false);
  } finally {
    await client.close();
    await server.close();
  }
});
