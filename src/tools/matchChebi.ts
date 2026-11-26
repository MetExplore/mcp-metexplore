// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChebiMatch, ChebiMatchResult } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";
import { METEXPLORE_QUERY_ANNOTATIONS, textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const matchChebiInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network (obtained via search_organisms)"),
  chebi_ids: z
    .array(z.string())
    .min(1)
    .describe("ChEBI identifiers to match, e.g. ['CHEBI:17234', 'CHEBI:15377'] (the 'CHEBI:' prefix is optional)"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result: markdown table or text. Default: table."),
};

/** Maximum number of matches listed for one queried ChEBI. */
export const MAX_MATCHES_PER_CHEBI = 100;

/** "CHEBI:17234", "chebi:17234" or "17234" → "chebi:17234"; undefined when not a ChEBI identifier. */
export function normalizeChebiId(value: string): string | undefined {
  const m = /^(?:chebi:)?(\d+)$/i.exec(value.trim());
  return m ? `chebi:${m[1]}` : undefined;
}

/** "chebi:17234" / "CHEBI:17234" / "17234" → "17234" (comparison key). */
function chebiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /(\d+)\s*$/.exec(String(value))?.[1];
}

/** "CHEBI:17234" display form. */
function displayChebi(value: string | undefined): string {
  const key = chebiKey(value);
  return key ? `CHEBI:${key}` : String(value ?? "");
}

export interface ChebiQuery {
  /** Identifier as given by the user (sent as `name`). */
  input: string;
  /** Normalized identifier sent to the API. */
  chebi: string;
}

/** Finds the API result for a query: by the name sent, or else by ChEBI number. */
function findResult(query: ChebiQuery, results: ChebiMatchResult[]): ChebiMatchResult | undefined {
  return (
    results.find((r) => r.name === query.input) ??
    results.find((r) => chebiKey(r.external_identifier) === chebiKey(query.chebi))
  );
}

function sortMatches(matches: ChebiMatch[]): ChebiMatch[] {
  return [...matches].sort(
    (a, b) =>
      (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER) ||
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.id - b.id,
  );
}

function toRow(m: ChebiMatch): Record<string, unknown> {
  return {
    id: m.id,
    db_identifier: m.db_identifier,
    name: m.name,
    compartments: (m.compartments ?? [])
      .map((c) => c.name ?? c.db_identifier)
      .filter(Boolean)
      .join(", "),
    matched_chebi: m.external_identifier ? displayChebi(m.external_identifier) : "",
    matched_chebi_name: m.external_identifier_name,
    relations: (m.relations ?? []).join(", "),
    distance: m.distance,
  };
}

const RELATIONS_LEGEND =
  "Relations (from the queried ChEBI to the ChEBI of the network metabolite): exact = same ChEBI; " +
  "parent-to-child / child-to-parent = linked by is_a links in the ChEBI ontology; conjugate = " +
  "conjugate acid/base; tautomer; enantiomer. distance = number of steps in the ontology (0 = exact).";

/** Text report of the ontology-based ChEBI matching. */
export function renderChebiMatchReport(
  queries: ChebiQuery[],
  invalid: string[],
  results: ChebiMatchResult[],
  idNetwork: number,
  format: OutputFormat,
): string {
  const notMatched: string[] = [];
  const sections: string[] = [];

  for (const query of queries) {
    const result = findResult(query, results);
    const matches = sortMatches(result?.matching_results ?? []);
    const label = displayChebi(query.chebi);
    const chebiName = result?.external_identifier_name;
    if (matches.length === 0) {
      notMatched.push(chebiName ? `${label} (${chebiName})` : label);
      continue;
    }
    const shown = matches.slice(0, MAX_MATCHES_PER_CHEBI);
    const nbExact = matches.filter((m) => m.distance === 0 || (m.relations ?? []).includes("exact")).length;
    let section =
      `\n**${label}${chebiName ? ` (${chebiName})` : ""}**: ${matches.length} matching metabolite(s), ` +
      `${nbExact} exact.\n${renderRows(format, shown.map(toRow))}`;
    if (matches.length > shown.length) {
      section += `\n${matches.length - shown.length} more metabolite(s) not shown.`;
    }
    sections.push(section);
  }

  const nbMatched = queries.length - notMatched.length;
  const parts = [
    `ChEBI ontology matching on network ${idNetwork}: ${nbMatched}/${queries.length} ChEBI identifier(s) ` +
      `matched, ${notMatched.length} without any match.`,
    ...sections,
  ];
  if (notMatched.length > 0) {
    parts.push(`\n**Not matched:**\n${notMatched.map((e) => `- ${e}`).join("\n")}`);
  }
  if (invalid.length > 0) {
    parts.push(`\n**Not ChEBI identifiers (ignored):**\n${invalid.map((e) => `- ${e}`).join("\n")}`);
  }
  if (sections.length > 0) parts.push(`\n${RELATIONS_LEGEND}`);
  return parts.join("\n");
}

export function registerMatchChebi(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "match_chebi",
    {
      title: "Match ChEBI identifiers to network metabolites using the ChEBI ontology",
      description:
        "Matches one or several ChEBI identifiers to the metabolites of a MetExplore network using the " +
        "ChEBI ontology: besides exact matches, it finds related metabolites (more generic or more " +
        "specific ChEBI classes, conjugate acid/base, tautomers, enantiomers), each with its relation and " +
        "distance in the ontology. Use it when the user asks for metabolites related/close to a ChEBI, " +
        "when search_metabolites_by_external_id finds no exact match for a ChEBI, or to match a list of " +
        "ChEBI identifiers (e.g. from metabolomics) onto a network. Requires an id_network (see " +
        "search_organisms); the network must contain ChEBI cross-references.",
      inputSchema: matchChebiInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
    },
    withErrorHandling(async (args, { client }) => {
      const queries: ChebiQuery[] = [];
      const invalid: string[] = [];
      for (const input of args.chebi_ids as string[]) {
        const chebi = normalizeChebiId(input);
        if (!chebi) invalid.push(input);
        else if (!queries.some((q) => q.chebi === chebi)) queries.push({ input: input.trim(), chebi });
      }
      if (queries.length === 0) {
        return textResult(
          `None of the given identifiers is a ChEBI identifier (${invalid.join(", ")}). Expected e.g. ` +
            "'CHEBI:17234'. For other databases, use search_metabolites_by_external_id.",
        );
      }
      const results = await client.matchChebi(
        args.id_network,
        queries.map((q) => ({ name: q.input, input_id: q.chebi })),
      );
      return textResult(
        renderChebiMatchReport(queries, invalid, results, args.id_network, args.output_format ?? "table"),
      );
    }, ctx),
  );
}
