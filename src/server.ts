import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetExploreApiClient } from "./apiClient.js";
import { MetExploreCache } from "./cache.js";
import type { Config, TransportMode } from "./config.js";
import type { ToolContext } from "./tools/shared.js";
import { registerSearchOrganisms } from "./tools/searchOrganisms.js";
import { registerSearchMetabolites } from "./tools/searchMetabolites.js";
import { registerSearchMetabolitesByFormula } from "./tools/searchMetabolitesByFormula.js";
import { registerCountReactionsForMetabolite } from "./tools/countReactionsForMetabolite.js";
import { registerMapMetabolites } from "./tools/mapMetabolites.js";
import { registerGetQuotaStatus } from "./tools/getQuotaStatus.js";

export const SERVER_NAME = "mcp-metexplore";
export const SERVER_VERSION = "0.2.0";

export const SERVER_INSTRUCTIONS =
  "Tools to query MetExplore metabolic networks. Start with search_organisms to get an id_network. " +
  "To find metabolites by name or identifier, use search_metabolites. Whenever the user asks for " +
  "metabolites by chemical (molecular) formula, e.g. 'C3H3O4' or 'C6H12O6', use " +
  "search_metabolites_by_formula: it lists every metabolite of the network with that formula, " +
  "whereas search_metabolites only matches names.";

/**
 * Builds an MCP server bound to one MetExplore session: its own API client
 * (credentials + request quota) and its own cache.
 */
export function createMcpServer(config: Config, mode: TransportMode): { server: McpServer; ctx: ToolContext } {
  const client = new MetExploreApiClient(config, { mode });
  const cache = new MetExploreCache(client);
  const ctx: ToolContext = { client, cache, config };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerSearchOrganisms(server, ctx);
  registerSearchMetabolites(server, ctx);
  registerSearchMetabolitesByFormula(server, ctx);
  registerCountReactionsForMetabolite(server, ctx);
  registerMapMetabolites(server, ctx);
  registerGetQuotaStatus(server, ctx);

  return { server, ctx };
}
