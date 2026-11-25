// SPDX-License-Identifier: Apache-2.0
import type { MappingResponse, Pathway } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";

const MAX_ENRICHMENT_ROWS = 20;

/** Kind of biological entity mapped onto a network. */
export type MappedEntityKind = "metabolite" | "gene";

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
  kind: `${MappedEntityKind}_mapping`;
  id_network: number;
  mapped: { entry: string; db_identifier: string }[];
  not_found: string[];
  ambiguous: { entry: string; db_identifiers: string[] }[];
  /** Top enriched pathways, sorted by bh_pval. */
  pathways: MappingPathway[];
}

export interface MappingReportOptions {
  kind: MappedEntityKind;
  idNetwork: number;
  queriedIds: string[];
  mapping: MappingResponse;
  format: OutputFormat;
  pathways?: Pathway[];
  /** Details shown for each candidate of an ambiguous entry (name, formula...). */
  describeCandidate?: (dbIdentifier: string) => Record<string, unknown>;
  /** Extra note appended when a large number of pathways is significant. */
  manySignificantNote?: (significantCount: number) => string;
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
  const all = Object.entries(mapping.statistics?.enrichment ?? {})
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

/** Builds the mapping report (mapped / not found / ambiguous + pathway enrichment). */
export function buildEntityMappingReport(opts: MappingReportOptions): { text: string; structured: MappingStructured } {
  const { kind, idNetwork, queriedIds, mapping, format } = opts;
  const describe = opts.describeCandidate ?? (() => ({}));

  const unmapped: string[] = [];
  const mapped: { entry: string; db_identifier: string }[] = [];
  const ambiguous: { entry: string; candidates: Record<string, unknown>[] }[] = [];

  for (const entry of queriedIds) {
    const matchesForEntry = mapping.map?.[entry];
    if (!matchesForEntry || matchesForEntry.length === 0) {
      unmapped.push(entry);
    } else if (matchesForEntry.length === 1) {
      mapped.push({ entry, db_identifier: matchesForEntry[0] });
    } else {
      ambiguous.push({
        entry,
        candidates: matchesForEntry.map((dbId) => ({ db_identifier: dbId, ...describe(dbId) })),
      });
    }
  }

  const stats = mapping.statistics ?? { nb_queries: queriedIds.length, nb_mapped_queries: mapped.length + ambiguous.length };
  const pct = stats.nb_queries > 0 ? ((stats.nb_mapped_queries / stats.nb_queries) * 100).toFixed(1) : "0";

  const parts: string[] = [];
  parts.push(
    `${kind === "gene" ? "Gene mapping" : "Mapping"} report on network ${idNetwork}: ` +
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
    parts.push(`\n**Ambiguous (several matching ${kind}s, to choose from):**\n${renderRows(format, ambiguousRows)}`);
  }

  const enrichment = rankEnrichedPathways(mapping, opts.pathways ?? []);
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
    if (significantCount > MAX_ENRICHMENT_ROWS && opts.manySignificantNote) {
      parts.push(`\n${opts.manySignificantNote(significantCount)}`);
    }
  }

  return {
    text: parts.join("\n"),
    structured: {
      kind: `${kind}_mapping`,
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
