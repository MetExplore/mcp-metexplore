// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite, MappingResponse, Pathway } from "../apiClient.js";
import type { OutputFormat } from "../format.js";
import { buildEntityMappingReport, type MappingStructured } from "./mapping.js";
import { METEXPLORE_QUERY_ANNOTATIONS, withErrorHandling, type ToolContext } from "./shared.js";

export const mapMetabolitesInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network to map onto"),
  ids: z
    .array(z.string())
    .min(1)
    .describe("List of metabolite identifiers to map (matched against the network's db_identifier)"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the mapping report: markdown table or text. Default: table."),
};

export type { MappingPathway, MappingStructured } from "./mapping.js";

/**
 * Builds the metabolite mapping report from the raw API response and the
 * network's metabolite list (to enrich ambiguous entries without an extra API call).
 */
export function buildMappingReport(
  idNetwork: number,
  queriedIds: string[],
  mapping: MappingResponse,
  metabolites: Metabolite[],
  format: OutputFormat,
  pathways: Pathway[] = [],
): { text: string; structured: MappingStructured } {
  const byDbId = new Map(metabolites.map((m) => [m.db_identifier, m]));
  return buildEntityMappingReport({
    kind: "metabolite",
    idNetwork,
    queriedIds,
    mapping,
    format,
    pathways,
    describeCandidate: (dbId) => {
      const m = byDbId.get(dbId);
      return { id: m?.id, name: m?.name, chemical_formula: m?.chemical_formula };
    },
    manySignificantNote: (significantCount) =>
      `Note: with ${significantCount} pathways significant, the query metabolites are likely ` +
      "highly-connected cofactors/currency metabolites (e.g. ATP, ADP, NAD, H2O, CO2) rather than " +
      "markers of one specific pathway — treat the ranking above as the most informative signal, " +
      "not an exhaustive list of relevant pathways.",
  });
}

export function registerMapMetabolites(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "map_metabolites",
    {
      title: "Map a list of metabolite identifiers onto a network",
      description:
        "Maps a list of metabolite identifiers (db_identifier) onto a MetExplore network and " +
        "produces a report: mapped, not found, or ambiguous entries (several matching metabolites, " +
        "each with its full name, formula and cross-references so the user can choose), AND a " +
        "pathway enrichment table (right-tailed Fisher exact test, with Bonferroni and " +
        "Benjamini-Hochberg corrected p-values, with the numeric pathway id) for the mapped metabolites — this already answers " +
        "'which pathways are overrepresented' questions; no other tool or export is needed for that. " +
        "The target network must first be resolved via search_organisms.",
      inputSchema: mapMetabolitesInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
    },
    withErrorHandling(async (args, { client, cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const [mapping, metabolites, pathways] = await Promise.all([
        client.mapMetaboliteIds(args.id_network, args.ids),
        cache.getMetabolites(args.id_network),
        // pathway ids are only needed to draw a pathway: do not fail the mapping without them
        cache.getPathways(args.id_network).catch(() => [] as Pathway[]),
      ]);
      const { text, structured } = buildMappingReport(
        args.id_network,
        args.ids,
        mapping,
        metabolites,
        format,
        pathways,
      );
      return {
        content: [{ type: "text", text }],
        structuredContent: structured as unknown as Record<string, unknown>,
      };
    }, ctx),
  );
}
