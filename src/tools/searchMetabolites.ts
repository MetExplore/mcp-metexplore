import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite } from "../apiClient.js";
import { formatCrossRefs, renderRows, type OutputFormat } from "../format.js";
import { jsonResult, textResult, withErrorHandling, type ToolContext } from "./shared.js";
import { findMetabolitesByFormula, looksLikeFormula, renderFormulaResult } from "./searchMetabolitesByFormula.js";

export const searchMetabolitesInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network (obtained via search_organisms)"),
  query: z
    .string()
    .describe("Name (or fragment of a name, or db_identifier) of the metabolite to look for, e.g. 'glucose'"),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result when ambiguous: markdown table or text. Default: table."),
};

/** Minimum similarity (0-1) for a fuzzy (typo-tolerant) match to be kept. */
export const FUZZY_THRESHOLD = 0.8;
/** Below this length (normalized query), only exact / word / substring matches are used. */
export const MIN_FUZZY_QUERY_LENGTH = 4;
/** Below this length (normalized query), substring matches are not used either. */
export const MIN_CONTAINS_QUERY_LENGTH = 3;
/** Maximum number of candidates listed when the query is ambiguous. */
export const MAX_CANDIDATES = 25;

const SCORE_EXACT = 1;
const SCORE_ALL_WORDS = 0.9;
const SCORE_CONTAINS = 0.8;
/** Fuzzy scores are scaled into [0.5, 0.79] so they always rank below exact/word/substring matches. */
const fuzzyScore = (similarity: number) => 0.5 + (similarity - FUZZY_THRESHOLD) * 1.45;

export type MatchKind = "exact" | "all words" | "contains" | "similar";

export interface ScoredMetabolite {
  metabolite: Metabolite;
  score: number;
  match: MatchKind;
}

const GREEK: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "epsilon",
  ω: "omega",
};

interface Normalized {
  tokens: string[];
  compact: string;
}

/**
 * Lowercases, maps Greek letters to their names, strips accents, and splits on
 * anything that is not a letter or digit: "β-D-Glucose" → ["beta", "d", "glucose"].
 */
export function normalizeName(value: string): Normalized {
  const tokens = value
    .toLowerCase()
    .replace(/[αβγδεω]/g, (c) => ` ${GREEK[c]} `)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return { tokens, compact: tokens.join("") };
}

/** Levenshtein distance; returns Infinity as soon as it is known to exceed maxDist. */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) return Infinity;
    prev = curr;
  }
  return prev[b.length];
}

/** Similarity in [0, 1]: 1 - distance / longest length (0 if below `min`). */
function similarity(a: string, b: string, min = FUZZY_THRESHOLD): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 1;
  const dist = levenshtein(a, b, Math.floor((1 - min) * len));
  return dist === Infinity ? 0 : 1 - dist / len;
}

/**
 * Token-level similarity: each query token is paired with its most similar field
 * token, and the result is averaged, weighted by token length (so "d" in
 * "d glucose" weighs less than "glucose"). Word order is ignored.
 */
function tokenSimilarity(query: string[], field: string[]): number {
  let total = 0;
  let weight = 0;
  for (const q of query) {
    const best = Math.max(0, ...field.map((f) => similarity(q, f, 0.5)));
    total += best * q.length;
    weight += q.length;
  }
  return weight === 0 ? 0 : total / weight;
}

/**
 * Scores one field against the query. `fuzzy` is disabled for identifiers: codes
 * like "glc__D_c" and "glc__L_c" differ by one character but are different compounds.
 */
function scoreField(
  query: Normalized,
  field: Normalized,
  fuzzy: boolean,
): { score: number; match: MatchKind } | undefined {
  if (field.compact.length === 0) return undefined;
  if (query.compact === field.compact) return { score: SCORE_EXACT, match: "exact" };
  if (query.tokens.every((t) => field.tokens.includes(t))) return { score: SCORE_ALL_WORDS, match: "all words" };
  if (query.compact.length >= MIN_CONTAINS_QUERY_LENGTH && field.compact.includes(query.compact)) {
    return { score: SCORE_CONTAINS, match: "contains" };
  }
  if (fuzzy && query.compact.length >= MIN_FUZZY_QUERY_LENGTH) {
    const sim = Math.max(similarity(query.compact, field.compact), tokenSimilarity(query.tokens, field.tokens));
    if (sim >= FUZZY_THRESHOLD) return { score: fuzzyScore(sim), match: "similar" };
  }
  return undefined;
}

/**
 * Fuzzy search of metabolites by name or db_identifier. Returns every metabolite
 * close enough to the query, best first: exact matches, then names containing all
 * the query words, then names containing the query, then typo-tolerant matches.
 */
export function findMetaboliteCandidates(metabolites: Metabolite[], query: string): ScoredMetabolite[] {
  const q = normalizeName(query);
  if (q.compact.length === 0) return [];

  const found: ScoredMetabolite[] = [];
  for (const metabolite of metabolites) {
    let best: { score: number; match: MatchKind } | undefined;
    const fields: [unknown, boolean][] = [
      [metabolite.name, true],
      [metabolite.db_identifier, false],
    ];
    for (const [field, fuzzy] of fields) {
      if (typeof field !== "string") continue;
      const s = scoreField(q, normalizeName(field), fuzzy);
      if (s && (!best || s.score > best.score)) best = s;
    }
    if (best) found.push({ metabolite, ...best });
  }
  return found.sort(
    (a, b) =>
      b.score - a.score ||
      (a.metabolite.name ?? "").localeCompare(b.metabolite.name ?? "") ||
      a.metabolite.id - b.metabolite.id,
  );
}

function toRow({ metabolite: m, score, match }: ScoredMetabolite): Record<string, unknown> {
  return {
    id: m.id,
    db_identifier: m.db_identifier,
    name: m.name,
    match,
    score: score.toFixed(2),
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
        "Fuzzy search of the metabolites of a MetExplore network by name (or db_identifier, matched " +
        "exactly or as a fragment). Name matching is tolerant to case, accents, punctuation, Greek letters (β = beta), word order and small typos, but " +
        "far-fetched matches are discarded. Returns the metabolite only if exactly one matches. As " +
        "soon as several metabolites match (even if one matches exactly, or the same metabolite " +
        "exists in several compartments), the result lists every candidate, best first, with its " +
        "id, identifier, match kind, chemical formula, compartment and cross-references (KEGG/ChEBI/...): " +
        "ask the user which one they mean instead of choosing. If nothing is close enough, says that " +
        "no metabolite was found. Requires an id_network (see search_organisms). To search by " +
        "chemical formula (e.g. C3H3O4), use search_metabolites_by_formula instead; to search by external " +
        "identifier (ChEBI, KEGG, HMDB...), use search_metabolites_by_external_id.",
      inputSchema: searchMetabolitesInputSchema,
    },
    withErrorHandling(async (args, { cache }) => {
      const format: OutputFormat = args.output_format ?? "table";
      const metabolites = await cache.getMetabolites(args.id_network);
      const found = findMetaboliteCandidates(metabolites, args.query);
      const isFormula = looksLikeFormula(args.query);

      // A formula given to the name search: answer with the formula search when no
      // name/identifier matches, otherwise point out the formula matches as well.
      if (isFormula && found.length === 0) {
        return textResult(
          `"${args.query}" looks like a chemical formula, so the network was searched by formula ` +
            "(see search_metabolites_by_formula).\n\n" +
            renderFormulaResult(metabolites, args.query, args.id_network, format),
        );
      }
      const formulaNote =
        isFormula && findMetabolitesByFormula(metabolites, args.query).length > 0
          ? `\n\n"${args.query}" also looks like a chemical formula: call search_metabolites_by_formula ` +
            "to list every metabolite with this formula."
          : "";

      if (found.length === 0) {
        return textResult(
          `No metabolite matching the name "${args.query}" was found in network ${args.id_network}.`,
        );
      }
      if (found.length === 1) {
        if (formulaNote) {
          return textResult(JSON.stringify({ status: "ok", metabolite: found[0].metabolite }, null, 2) + formulaNote);
        }
        return jsonResult({ status: "ok", metabolite: found[0].metabolite });
      }

      const exact = found.filter((f) => f.match === "exact");
      const shown = found.slice(0, MAX_CANDIDATES);
      const parts = [
        `${found.length} metabolites match "${args.query}" — the query is ambiguous: ask the user ` +
          "which one they mean (by its id) before going further.",
      ];
      if (exact.length > 0) {
        parts.push(
          `Exact name match: ${exact.map((f) => `${f.metabolite.name} (id ${f.metabolite.id})`).join(", ")}.`,
        );
      }
      parts.push(`\n${renderRows(format, shown.map(toRow))}`);
      if (found.length > shown.length) {
        parts.push(
          `\n${found.length - shown.length} more candidate(s) not shown — refine the query to narrow the list.`,
        );
      }
      return textResult(parts.join("\n") + formulaNote);
    }, ctx),
  );
}
