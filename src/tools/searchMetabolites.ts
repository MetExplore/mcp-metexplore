import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";
import { jsonResult, textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const searchMetabolitesInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network (obtained via search_organisms)"),
  query: z.string().describe("Name (or fragment of a name) of the metabolite to look for, e.g. 'glucose'"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result when ambiguous: markdown table or text. Default: table."),
};

function formatCrossRefs(m: Metabolite): string {
  return (m.cross_refs ?? []).map((r) => `${r.ext_db_name}:${r.ext_id}`).join("; ");
}

function toRow(m: Metabolite): Record<string, unknown> {
  return {
    id: m.id,
    db_identifier: m.db_identifier,
    name: m.name,
    chemical_formula: m.chemical_formula,
    charge: m.charge,
    compartment: m.compartment?.name,
    cross_refs: formatCrossRefs(m),
  };
}

export function registerSearchMetabolites(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "search_metabolites",
    {
      title: "Search for a metabolite in a MetExplore network",
      description:
        "Searches the metabolites of a MetExplore network whose name contains the query. If several " +
        "metabolites match, the result lists each candidate with its id, identifier (db_identifier), " +
        "chemical formula and cross-references (KEGG/ChEBI/...) so the user can choose. Requires an " +
        "id_network (see search_organisms).",
      inputSchema: searchMetabolitesInputSchema,
    },
    withErrorHandling(async (args, { cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const metabolites = await cache.getMetabolites(args.id_network);
      const q = args.query.toLowerCase();
      const found = metabolites.filter((m) => m.name?.toLowerCase().includes(q));

      if (found.length === 0) {
        return textResult(`No metabolite matches "${args.query}" in network ${args.id_network}.`);
      }
      if (found.length === 1) {
        return jsonResult({ status: "ok", metabolite: found[0] });
      }
      return textResult(
        `${found.length} metabolites match "${args.query}" — specify which one to use ` +
          `(by its id):\n\n${renderRows(format, found.map(toRow))}`,
      );
    }, ctx),
  );
}
