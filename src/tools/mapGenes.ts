// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MappingResponse, Pathway } from "../apiClient.js";
import type { OutputFormat } from "../format.js";
import { buildEntityMappingReport, type MappingStructured } from "./mapping.js";
import { METEXPLORE_QUERY_ANNOTATIONS, withErrorHandling, type ToolContext } from "./shared.js";

export const mapGenesInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network to map onto"),
  ids: z
    .array(z.string())
    .min(1)
    .describe(
      "List of gene identifiers to map, matched against the whole db_identifier of the network genes " +
        "(exact match, or a regular expression such as 'b00.*')",
    ),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the mapping report: markdown table or text. Default: table."),
};

/** Builds the gene mapping report (mapped / not found / ambiguous + pathway enrichment). */
export function buildGeneMappingReport(
  idNetwork: number,
  queriedIds: string[],
  mapping: MappingResponse,
  format: OutputFormat,
  pathways: Pathway[] = [],
): { text: string; structured: MappingStructured } {
  return buildEntityMappingReport({ kind: "gene", idNetwork, queriedIds, mapping, format, pathways });
}

export function registerMapGenes(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "map_genes",
    {
      title: "Map a list of gene identifiers onto a network",
      description:
        "Maps a list of gene identifiers (db_identifier, exact or regular expression) onto a MetExplore " +
        "network and produces a report: mapped, not found, or ambiguous entries (several matching genes), " +
        "AND a pathway enrichment table (right-tailed Fisher exact test, with Bonferroni and " +
        "Benjamini-Hochberg corrected p-values, with the numeric pathway id) for the mapped genes — this " +
        "already answers 'which pathways are overrepresented' questions; no other tool or export is needed " +
        "for that. The target network must first be resolved via search_organisms.",
      inputSchema: mapGenesInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
    },
    withErrorHandling(async (args, { client, cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const [mapping, pathways] = await Promise.all([
        client.mapGeneIds(args.id_network, args.ids),
        // pathway ids are only needed to draw a pathway: do not fail the mapping without them
        cache.getPathways(args.id_network).catch(() => [] as Pathway[]),
      ]);
      const { text, structured } = buildGeneMappingReport(args.id_network, args.ids, mapping, format, pathways);
      return {
        content: [{ type: "text", text }],
        structuredContent: structured as unknown as Record<string, unknown>,
      };
    }, ctx),
  );
}
