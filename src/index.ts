#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { MetExploreApiClient } from "./apiClient.js";
import { MetExploreCache } from "./cache.js";
import type { ToolContext } from "./tools/shared.js";
import { registerSearchOrganisms } from "./tools/searchOrganisms.js";
import { registerSearchMetabolites } from "./tools/searchMetabolites.js";
import { registerCountReactionsForMetabolite } from "./tools/countReactionsForMetabolite.js";
import { registerMapMetabolites } from "./tools/mapMetabolites.js";
import { registerExportNetworkSbml } from "./tools/exportNetworkSbml.js";
import { registerGetQuotaStatus } from "./tools/getQuotaStatus.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[mcp-metexplore] Invalid configuration: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  const client = new MetExploreApiClient(config);
  const cache = new MetExploreCache(client);
  const ctx: ToolContext = { client, cache, config };

  const server = new McpServer({ name: "mcp-metexplore", version: "0.1.0" });

  registerSearchOrganisms(server, ctx);
  registerSearchMetabolites(server, ctx);
  registerCountReactionsForMetabolite(server, ctx);
  registerMapMetabolites(server, ctx);
  registerExportNetworkSbml(server, ctx);
  registerGetQuotaStatus(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp-metexplore] Server started (API: ${config.apiUrl}, quota: ${config.maxRequestsPerSession} req/session)`);
}

main().catch((err) => {
  console.error("[mcp-metexplore] Fatal error:", err);
  process.exit(1);
});
