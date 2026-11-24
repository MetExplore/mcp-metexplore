// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite, MappingResponse, Pathway } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";
import { withErrorHandling, type ToolContext } from "./shared.js";

const MAX_ENRICHMENT_ROWS = 20;

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

/** One enriched pathway in the structured mapping result. */
export interface MappingPathway {
  /** Numeric pathway id (for /networks/{id_network}/pathways/{id}/graph), null if unresolved. */
  id: number | null;
  db_identifier: string;
  name: string;
  mapped: number;
  total: number;
  pval: number;
  bonferroni_pval: number;
  bh_pval: number;
}

/** Machine-readable mapping result, returned as MCP structuredContent (for client UIs). */
export interface MappingStructured {
  kind: "metabolite_mapping";
  id_network: number;
  mapped: { entry: string; db_identifier: string }[];
  not_found: string[];
  ambiguous: { entry: string; db_identifiers: string[] }[];
  /** Top enriched pathways, sorted by bh_pval. */
  pathways: MappingPathway[];
}

/**
 * Enriched pathways sorted by bh_pval (top MAX_ENRICHMENT_ROWS), with their numeric id
 * resolved from the network pathways (the enrichment is keyed by the pathway db_identifier).
 */
function rankEnrichedPathways(mapping: MappingResponse, pathways: Pathway[]): {
  total: number;
  significant: number;
  top: MappingPathway[];
} {
  const byDbId = new Map(pathways.map((p) => [p.db_identifier, p]));
  const byName = new Map(pathways.map((p) => [p.name, p]));
  const all = Object.entries(mapping.statistics.enrichment ?? {})
    .map(([key, e]): MappingPathway => {
      const p = byDbId.get(key) ?? byName.get(key) ?? byName.get(e.label);
      return {
        id: p?.id ?? null,
        db_identifier: p?.db_identifier ?? key,
        name: e.label,
        mapped: e.nb_mapped_biodata,
        total: e.nb_total_biodata,
        pval: e.pval,
        bonferroni_pval: e.bonferroni_pval,
        bh_pval: e.bh_pval,
      };
    })
    .sort((a, b) => a.bh_pval - b.bh_pval);
  return {
    total: all.length,
    significant: all.filter((e) => e.bh_pval < 0.05).length,
    top: all.slice(0, MAX_ENRICHMENT_ROWS),
  };
}

/**
 * Builds the mapping report (mapped / not found / ambiguous) from the raw API
 * response and the network's metabolite list (to enrich ambiguous entries
 * without an extra API call).
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

  const unmapped: string[] = [];
  const mapped: { entry: string; db_identifier: string }[] = [];
  const ambiguous: { entry: string; candidates: Record<string, unknown>[] }[] = [];

  for (const entry of queriedIds) {
    const matchesForEntry = mapping.map[entry];
    if (!matchesForEntry || matchesForEntry.length === 0) {
      unmapped.push(entry);
    } else if (matchesForEntry.length === 1) {
      mapped.push({ entry, db_identifier: matchesForEntry[0] });
    } else {
      ambiguous.push({
        entry,
        candidates: matchesForEntry.map((dbId) => {
          const m = byDbId.get(dbId);
          return {
            db_identifier: dbId,
            id: m?.id,
            name: m?.name,
            chemical_formula: m?.chemical_formula,
          };
        }),
      });
    }
  }

  const stats = mapping.statistics;
  const pct = stats.nb_queries > 0 ? ((stats.nb_mapped_queries / stats.nb_queries) * 100).toFixed(1) : "0";

  const parts: string[] = [];
  parts.push(
    `Mapping report on network ${idNetwork}: ` +
      `${stats.nb_mapped_queries}/${stats.nb_queries} identifier(s) mapped (${pct}%), ` +
      `${unmapped.length} not found, ${ambiguous.length} ambiguous.`,
  );

  if (mapped.length > 0) {
    parts.push(`\n**Mapped:**\n${renderRows(format, mapped)}`);
  }
  if (unmapped.length > 0) {
    parts.push(`\n**Not found:**\n${unmapped.map((e) => `- ${e}`).join("\n")}`);
  }
  if (ambiguous.length > 0) {
    const ambiguousRows = ambiguous.flatMap((a) => a.candidates.map((c) => ({ entry: a.entry, ...c })));
    parts.push(`\n**Ambiguous (several matching metabolites, to choose from):**\n${renderRows(format, ambiguousRows)}`);
  }

  const enrichment = rankEnrichedPathways(mapping, pathways);
  const significantCount = enrichment.significant;
  const topEnrichmentRows = enrichment.top.map((e) => ({
    pathway: e.name,
    id: e.id ?? "",
    mapped: e.mapped,
    total: e.total,
    pval: e.pval.toExponential(2),
    bonferroni_pval: e.bonferroni_pval.toExponential(2),
    bh_pval: e.bh_pval.toExponential(2),
  }));
  if (topEnrichmentRows.length > 0) {
    const omitted = enrichment.total - topEnrichmentRows.length;
    parts.push(
      `\n**Pathway enrichment**: ${significantCount}/${enrichment.total} pathway(s) with ` +
        "mapped entities are significant at bh_pval < 0.05 (right-tailed Fisher exact test; " +
        `pval/bonferroni_pval/bh_pval columns). Top ${topEnrichmentRows.length} by bh_pval` +
        `${omitted > 0 ? ` (${omitted} more omitted)` : ""}:\n${renderRows(format, topEnrichmentRows)}`,
    );
    if (significantCount > MAX_ENRICHMENT_ROWS) {
      parts.push(
        `\nNote: with ${significantCount} pathways significant, the query metabolites are likely ` +
          "highly-connected cofactors/currency metabolites (e.g. ATP, ADP, NAD, H2O, CO2) rather than " +
          "markers of one specific pathway — treat the ranking above as the most informative signal, " +
          "not an exhaustive list of relevant pathways.",
      );
    }
  }

  return {
    text: parts.join("\n"),
    structured: {
      kind: "metabolite_mapping",
      id_network: idNetwork,
      mapped,
      not_found: unmapped,
      ambiguous: ambiguous.map((a) => ({
        entry: a.entry,
        db_identifiers: a.candidates.map((c) => String(c.db_identifier)),
      })),
      pathways: enrichment.top,
    },
  };
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
