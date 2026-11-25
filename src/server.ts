// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetExploreApiClient } from "./apiClient.js";
import { MetExploreCache } from "./cache.js";
import type { Config, TransportMode } from "./config.js";
import type { ToolContext } from "./tools/shared.js";
import { registerSearchOrganisms } from "./tools/searchOrganisms.js";
import { registerSearchMetabolites } from "./tools/searchMetabolites.js";
import { registerSearchMetabolitesByFormula } from "./tools/searchMetabolitesByFormula.js";
import { registerSearchMetabolitesByExternalId } from "./tools/searchMetabolitesByExternalId.js";
import { registerCountReactionsForMetabolite } from "./tools/countReactionsForMetabolite.js";
import { registerMatchChebi } from "./tools/matchChebi.js";
import { registerMapMetabolites } from "./tools/mapMetabolites.js";
import { registerMapGenes } from "./tools/mapGenes.js";
import { registerGetQuotaStatus } from "./tools/getQuotaStatus.js";

export const SERVER_NAME = "mcp-metexplore";
export const PACKAGE_NAME = "@metexplore/mcp-metexplore";

/**
 * Version of the package, read from its package.json (the single source of truth: the repository
 * keeps "0.0.0" and the CI sets the release tag before publishing / building the image).
 * Searches upwards from this module, since it runs from dist/ (npm package, Docker image) as well
 * as from dist-test/src/ (unit tests).
 */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string") return pkg.version;
    } catch {
      // no (readable) package.json here: keep going up
    }
    const parent = dirname(dir);
    if (parent === dir) return "0.0.0";
    dir = parent;
  }
}

export const SERVER_VERSION = readPackageVersion();

export const SERVER_INSTRUCTIONS =
  "Tools to query MetExplore metabolic networks. Start with search_organisms to get an id_network. " +
  "To find metabolites by name or identifier, use search_metabolites. Whenever the user asks for " +
  "metabolites by chemical (molecular) formula, e.g. 'C3H3O4' or 'C6H12O6', use " +
  "search_metabolites_by_formula: it lists every metabolite of the network with that formula, " +
  "whereas search_metabolites only matches names. Whenever the user gives an external metabolite " +
  "identifier (ChEBI, KEGG, HMDB, MetaNetX, PubChem, LipidMaps, InChI, BiGG, VMH...), e.g. 'CHEBI:15422' " +
  "or 'C00002', use search_metabolites_by_external_id. To find metabolites related to a ChEBI " +
  "identifier through the ChEBI ontology (parent/child classes, conjugate acid/base, tautomers, " +
  "enantiomers), or when a ChEBI has no exact match, use match_chebi. To map a list of metabolite " +
  "identifiers onto a network, use map_metabolites; for a list of gene identifiers, use map_genes.";

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
  registerSearchMetabolitesByExternalId(server, ctx);
  registerCountReactionsForMetabolite(server, ctx);
  registerMatchChebi(server, ctx);
  registerMapMetabolites(server, ctx);
  registerMapGenes(server, ctx);
  registerGetQuotaStatus(server, ctx);

  return { server, ctx };
}
