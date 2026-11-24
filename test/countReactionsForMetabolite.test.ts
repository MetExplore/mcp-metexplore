// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetExploreApiClient } from "../src/apiClient.js";
import { MetExploreCache } from "../src/cache.js";
import type { Config } from "../src/config.js";
import { registerCountReactionsForMetabolite } from "../src/tools/countReactionsForMetabolite.js";

const config: Config = {
  apiUrl: "http://localhost:1337",
  appKey: "app-key",
  userToken: "user-token",
  maxRequestsPerSession: 20,
  tlsRejectUnauthorized: true,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function captureHandler(client: MetExploreApiClient) {
  let handler: ((args: any) => Promise<any>) | undefined;
  const server = {
    registerTool: (_name: string, _def: unknown, fn: (args: any) => Promise<any>) => {
      handler = fn;
    },
  } as unknown as McpServer;
  registerCountReactionsForMetabolite(server, { client, cache: new MetExploreCache(client), config });
  return handler!;
}

test("returns the reaction names, taken from the network reactions since /filter leaves them empty", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const path = url.replace(config.apiUrl, "");
    paths.push(path);
    if (path === "/filter") {
      return jsonResponse({ success: true, ids: [10, 11], db_identifiers: ["R10", "R11"], names: [] });
    }
    return jsonResponse({
      success: true,
      results: [
        { id: 10, db_identifier: "R10", name: "pyruvate carboxylase" },
        { id: 11, db_identifier: "R11", name: "pyruvate kinase" },
        { id: 12, db_identifier: "R12", name: "other" },
      ],
    });
  });

  const handler = captureHandler(new MetExploreApiClient(config));
  const result = await handler({ id_network: 5, id_metabolite: 42, output_format: "table" });
  const text: string = result.content[0].text;

  assert.match(text, /involved in 2 reaction\(s\)/);
  assert.match(text, /\| 10 \| R10 \| pyruvate carboxylase \|/);
  assert.match(text, /\| 11 \| R11 \| pyruvate kinase \|/);
  assert.doesNotMatch(text, /other/);
  assert.deepEqual(paths, ["/filter", "/reactions?id_network=5"]);

  // Second call: the reactions of the network come from the cache.
  await handler({ id_network: 5, id_metabolite: 42 });
  assert.deepEqual(paths, ["/filter", "/reactions?id_network=5", "/filter"]);
});

test("does not fetch the network reactions when the metabolite is in no reaction", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    paths.push(url.replace(config.apiUrl, ""));
    return jsonResponse({ success: true, ids: [], db_identifiers: [], names: [] });
  });
  const handler = captureHandler(new MetExploreApiClient(config));
  const result = await handler({ id_network: 5, id_metabolite: 42 });
  assert.match(result.content[0].text, /involved in 0 reaction\(s\)/);
  assert.deepEqual(paths, ["/filter"]);
});
