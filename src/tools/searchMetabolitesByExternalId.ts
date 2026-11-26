// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite } from "../apiClient.js";
import { formatCrossRefs, renderRows, type OutputFormat } from "../format.js";
import { METEXPLORE_QUERY_ANNOTATIONS, textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const searchMetabolitesByExternalIdInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network (obtained via search_organisms)"),
  external_id: z
    .string()
    .min(1)
    .describe(
      "External identifier of the metabolite, e.g. 'CHEBI:15422', 'C00002' (KEGG), 'HMDB0000538', " +
        "'MNXM3' (MetaNetX), or prefixed with its database: 'bigg.metabolite:atp', 'pubchem.compound:5957'",
    ),
  db: z
    .string()
    .optional()
    .describe(
      "Database of the identifier, as named in MetExplore (e.g. chebi, kegg.compound, hmdb, " +
        "metanetx.chemical, pubchem.compound, bigg.metabolite, vmhmetabolite, lipidmaps, inchi). " +
        "Optional: detected from the identifier when possible.",
    ),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result: markdown table or text. Default: table."),
};

/** Maximum number of rows listed in one answer. */
export const MAX_EXTERNAL_ID_RESULTS = 200;

/** Recognizable identifier patterns, by MetExplore database name (ext_db_name). */
export const ID_PATTERNS: { db: string; regex: RegExp }[] = [
  { db: "chebi", regex: /^CHEBI:\d+$/i },
  { db: "kegg.compound", regex: /^C\d{5}$/i },
  { db: "hmdb", regex: /^HMDB\d{5,7}$/i },
  { db: "metanetx.chemical", regex: /^MNXM\w+$/i },
  { db: "lipidmaps", regex: /^LM[A-Z]{2}\d{4,10}$/i },
  { db: "inchi", regex: /^InChI=/ },
  { db: "inchikey", regex: /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/ },
  // A bare number may be a ChEBI or a PubChem compound identifier.
  { db: "chebi", regex: /^\d+$/ },
  { db: "pubchem.compound", regex: /^\d+$/ },
];

/** Short database names accepted as a prefix ("kegg:C00002") or as `db`. */
const DB_ALIASES: Record<string, string> = {
  kegg: "kegg.compound",
  pubchem: "pubchem.compound",
  metanetx: "metanetx.chemical",
  mnx: "metanetx.chemical",
  bigg: "bigg.metabolite",
  vmh: "vmhmetabolite",
};

export interface DbCandidate {
  db: string;
  id: string;
}

/**
 * Finds the database named `name` (case-insensitive, aliases accepted) among the
 * available ones; returns its exact key, or undefined.
 */
export function resolveDbName(name: string, available: string[]): string | undefined {
  const lower = name.trim().toLowerCase();
  const target = DB_ALIASES[lower] ?? lower;
  return available.find((k) => k.toLowerCase() === target);
}

/**
 * Databases the identifier may belong to. An explicit "db:id" prefix naming one
 * of the available databases wins; otherwise the identifier patterns are used
 * (possibly several candidates, e.g. a bare number). Candidates found by pattern
 * may be absent from `available`.
 */
export function detectDatabases(externalId: string, available: string[]): DbCandidate[] {
  const value = externalId.trim();
  const sep = value.indexOf(":");
  if (sep > 0) {
    const db = resolveDbName(value.slice(0, sep), available);
    if (db) return [{ db, id: value.slice(sep + 1).trim() }];
  }
  const found: DbCandidate[] = [];
  for (const { db, regex } of ID_PATTERNS) {
    if (regex.test(value) && !found.some((c) => c.db === db)) found.push({ db, id: value });
  }
  return found;
}

/** Comparable form of an identifier: CHEBI:15422 = 15422, HMDB00538 = HMDB0000538. */
export function normalizeExtId(db: string, id: string): string {
  const value = id.trim();
  switch (db.toLowerCase()) {
    case "chebi":
      return value.replace(/^chebi:/i, "").toLowerCase();
    case "hmdb": {
      const m = /^hmdb0*(\d+)$/i.exec(value);
      return m ? `hmdb${m[1]}` : value.toLowerCase();
    }
    case "inchi":
      return value;
    default:
      return value.toLowerCase();
  }
}

/** Every metabolite with a cross-reference `db`:`id` (all compartments). */
export function findMetabolitesByExternalId(metabolites: Metabolite[], db: string, id: string): Metabolite[] {
  const dbLower = db.toLowerCase();
  const target = normalizeExtId(db, id);
  return metabolites
    .filter((m) =>
      (m.cross_refs ?? []).some(
        (r) =>
          typeof r.ext_db_name === "string" &&
          typeof r.ext_id === "string" &&
          r.ext_db_name.toLowerCase() === dbLower &&
          normalizeExtId(db, r.ext_id) === target,
      ),
    )
    .sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.compartment?.name ?? "").localeCompare(b.compartment?.name ?? "") ||
        a.id - b.id,
    );
}

/** "chebi (3633), kegg.compound (3838)" */
export function describeAvailableDbs(stats: Record<string, number>): string {
  return Object.entries(stats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([db, n]) => `${db} (${n})`)
    .join(", ");
}

export type DbResolution = { ok: true; db: string; id: string } | { ok: false; message: string };

/**
 * Chooses the database to search, checking that the network has cross-references
 * for it. When it can't be decided, the message asks the user to give `db`.
 */
export function resolveDatabase(
  externalId: string,
  db: string | undefined,
  stats: Record<string, number>,
  idNetwork: number,
): DbResolution {
  const available = Object.keys(stats).filter((k) => (stats[k] ?? 0) > 0);
  const list = describeAvailableDbs(Object.fromEntries(available.map((k) => [k, stats[k]])));

  if (db !== undefined && db.trim() !== "") {
    const key = resolveDbName(db, available);
    if (!key) {
      return {
        ok: false,
        message:
          `Network ${idNetwork} contains no metabolite cross-reference from the database "${db}". ` +
          `Databases available in this network (number of metabolites): ${list}.`,
      };
    }
    // Drop a redundant "db:" prefix, e.g. db = kegg.compound and id = "kegg.compound:C00002".
    const value = externalId.trim();
    const sep = value.indexOf(":");
    const id = sep > 0 && resolveDbName(value.slice(0, sep), available) === key ? value.slice(sep + 1) : value;
    return { ok: true, db: key, id: id.trim() };
  }

  const candidates = detectDatabases(externalId, available);
  if (candidates.length === 0) {
    return {
      ok: false,
      message:
        `The type of the identifier "${externalId}" was not recognized. Ask the user which database it ` +
        `comes from, then call this tool again with the db parameter. Databases available in network ` +
        `${idNetwork} (number of metabolites): ${list}.`,
    };
  }
  const present = candidates
    .map((c) => ({ ...c, db: resolveDbName(c.db, available) }))
    .filter((c): c is DbCandidate => c.db !== undefined);
  if (present.length === 0) {
    const names = candidates.map((c) => c.db).join(" or ");
    return {
      ok: false,
      message:
        `"${externalId}" looks like a ${names} identifier, but network ${idNetwork} contains no ` +
        `${names} cross-reference, so it cannot be searched. Databases available in this network ` +
        `(number of metabolites): ${list}.`,
    };
  }
  if (present.length > 1) {
    return {
      ok: false,
      message:
        `"${externalId}" may be an identifier from several databases of network ${idNetwork}: ` +
        `${present.map((c) => c.db).join(", ")}. Ask the user which one they mean, then call this tool ` +
        "again with the db parameter.",
    };
  }
  return { ok: true, db: present[0].db, id: present[0].id };
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

/** Text answer listing every metabolite of the network with the cross-reference db:id. */
export function renderExternalIdResult(
  metabolites: Metabolite[],
  db: string,
  id: string,
  idNetwork: number,
  format: OutputFormat,
): string {
  const found = findMetabolitesByExternalId(metabolites, db, id);
  if (found.length === 0) {
    return `No metabolite with the ${db} identifier ${id} was found in network ${idNetwork}.`;
  }
  const species = new Set(found.map((m) => m.name)).size;
  const shown = found.slice(0, MAX_EXTERNAL_ID_RESULTS);
  const parts = [
    `${found.length} metabolite(s) (${species} distinct name(s)) with the ${db} identifier ${id} in ` +
      `network ${idNetwork}. This is the complete list: every metabolite of the network was checked.`,
    `\n${renderRows(format, shown.map(toRow))}`,
  ];
  if (found.length > shown.length) {
    parts.push(`\n${found.length - shown.length} more metabolite(s) not shown.`);
  }
  return parts.join("\n");
}

export function registerSearchMetabolitesByExternalId(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "search_metabolites_by_external_id",
    {
      title: "Search metabolites by external identifier (ChEBI, KEGG, HMDB...) in a MetExplore network",
      description:
        "Lists ALL the metabolites of a MetExplore network cross-referenced to a given external " +
        "identifier (ChEBI, KEGG compound, HMDB, MetaNetX, PubChem, LipidMaps, InChI, BiGG, VMH...), " +
        "in every compartment. Use it whenever the user gives such an identifier, e.g. 'CHEBI:15422', " +
        "'C00002' or 'HMDB0000538'. The database is detected from the identifier, or given with db " +
        "(or as a prefix: 'bigg.metabolite:atp'). The tool first checks that the network contains " +
        "cross-references from that database. If the identifier type is not recognized or ambiguous, " +
        "the answer lists the databases available in the network: ask the user which one to use and " +
        "call again with db. Requires an id_network (see search_organisms).",
      inputSchema: searchMetabolitesByExternalIdInputSchema,
      annotations: METEXPLORE_QUERY_ANNOTATIONS,
    },
    withErrorHandling(async (args, { cache }) => {
      const network = await cache.getNetworkDetails(args.id_network);
      const stats = network.stats_refs_metabolites ?? {};
      if (!Object.values(stats).some((n) => n > 0)) {
        return textResult(
          `Network ${args.id_network} has no external metabolite identifiers (stats_refs_metabolites is ` +
            "empty): it cannot be searched by external identifier. Use search_metabolites to search by name.",
        );
      }
      const resolution = resolveDatabase(args.external_id, args.db, stats, args.id_network);
      if (!resolution.ok) return textResult(resolution.message);

      const metabolites = await cache.getMetabolites(args.id_network);
      return textResult(
        renderExternalIdResult(
          metabolites,
          resolution.db,
          resolution.id,
          args.id_network,
          args.output_format ?? "table",
        ),
      );
    }, ctx),
  );
}
