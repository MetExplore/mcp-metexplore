// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Network } from "../apiClient.js";
import { renderRows, type OutputFormat } from "../format.js";
import { METEXPLORE_QUERY_ANNOTATIONS, jsonResult, textResult, withErrorHandling, type ToolContext } from "./shared.js";

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
  "version",
  "db_identifier",
  "permission",
  "nb_metabolites",
  "nb_reactions",
];

/** Lowercases and strips everything but letters/digits: "Human-GEM" and "humangem" compare equal. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A query token that designates a model version: "2", "v2", "V2.0", "1.19". */
const VERSION_TOKEN = /^v?(\d+(?:\.\d+)*)$/i;

function textFields(network: Network): string[] {
  return [
    network.organism_name,
    network.name,
    network.strain,
    network.tissue,
    network.cell_type,
    network.db_identifier,
    network.identifier_origin,
    network.description,
  ].filter((field): field is string => typeof field === "string" && field.length > 0);
}

/**
 * True if the network's version matches the requested one, segment by segment:
 * "2" matches "2.0" or "2.1" but not "12.0" or "1.2". Also accepts a "V2"-style
 * suffix in the network's db_identifier or name (e.g. "HumanGEM-V2").
 */
function matchesVersion(network: Network, requested: string): boolean {
  const wanted = requested.split(".");
  if (typeof network.version === "string") {
    const actual = network.version.trim().replace(/^v/i, "").split(".");
    if (wanted.every((seg, i) => actual[i] !== undefined && Number(actual[i]) === Number(seg))) {
      return true;
    }
  }
  const tagged = new RegExp(`(^|[^a-z0-9])v${requested.replace(/\./g, "\\.")}(?![0-9])`, "i");
  return [network.db_identifier, network.name].some(
    (field) => typeof field === "string" && tagged.test(field),
  );
}

/**
 * A network matches when every word of the query is found in one of its text fields
 * (case- and punctuation-insensitive), and every version-like word ("2", "v2"...)
 * matches its version. A query made only of version-like words is matched as text.
 */
export function matches(network: Network, query: string): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const versions: string[] = [];
  const words: string[] = [];
  for (const token of tokens) {
    const m = VERSION_TOKEN.exec(token);
    if (m) versions.push(m[1]);
    else words.push(token);
  }
  if (words.length === 0) {
    words.push(...tokens);
    versions.length = 0;
  }

  const fields = textFields(network).map(normalize);
  const wordsOk = words.every((word) => {
    const w = normalize(word);
    return w.length > 0 && fields.some((field) => field.includes(w));
  });
  return wordsOk && versions.every((v) => matchesVersion(network, v));
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
        "choose from. The query is matched word by word, ignoring case and punctuation, " +
        "against names, identifiers and descriptions; a version-like word ('2', 'v2', '1.19') " +
        "filters on the model version, e.g. 'Human-GEM 2'.",
      inputSchema: searchOrganismsInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
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
