import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Network } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";
import { jsonResult, textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const searchOrganismsInputSchema = {
  query: z.string().describe("Name (or fragment of a name) of the organism to look for, e.g. 'Homo sapiens'"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result when ambiguous: markdown table or text. Default: table."),
};

const CANDIDATE_COLUMNS = [
  "id",
  "name",
  "organism_name",
  "strain",
  "tissue",
  "cell_type",
  "source",
  "permission",
  "nb_metabolites",
  "nb_reactions",
];

function matches(network: Network, query: string): boolean {
  const q = query.toLowerCase();
  return [
    network.organism_name,
    network.name,
    network.strain,
    network.tissue,
    network.cell_type,
    network.db_identifier,
    network.description,
  ].some((field) => typeof field === "string" && field.toLowerCase().includes(q));
}

export function registerSearchOrganisms(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "search_organisms",
    {
      title: "Search for a MetExplore organism",
      description:
        "Searches MetExplore metabolic networks matching an organism name. Use this before any " +
        "other tool that needs an id_network: if several networks match (e.g. 'Homo sapiens' can " +
        "match several strains/tissues/sources), the result lists the candidates for the user to " +
        "choose from.",
      inputSchema: searchOrganismsInputSchema,
    },
    withErrorHandling(async (args, { cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const networks = await cache.getNetworks();
      const found = networks.filter((n) => matches(n, args.query));

      if (found.length === 0) {
        return textResult(
          `No MetExplore network matches "${args.query}". ` +
            "Try another name (scientific name, strain, or a fragment of it).",
        );
      }
      if (found.length === 1) {
        return jsonResult({ status: "ok", network: found[0] });
      }
      return textResult(
        `${found.length} networks match "${args.query}" — specify which one to use ` +
          `(by its id_network):\n\n${renderRows(format, found as unknown as Record<string, unknown>[], CANDIDATE_COLUMNS)}`,
      );
    }, ctx),
  );
}
