import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Metabolite } from "../apiClient.js";
import { formatCrossRefs, renderRows, type OutputFormat } from "../format.js";
import { textResult, withErrorHandling, type ToolContext } from "./shared.js";

export const searchMetabolitesByFormulaInputSchema = {
  id_network: z.number().int().describe("Id of the MetExplore network (obtained via search_organisms)"),
  formula: z
    .string()
    .describe("Chemical (molecular) formula to look for, in any element order, e.g. 'C3H3O4' or 'C6H12O6'"),
  ignore_hydrogens: z
    .boolean()
    .optional()
    .describe(
      "If true, hydrogen counts are ignored so every protonation state matches " +
        "(e.g. C3H4O4 also finds C3H3O4 and C3H2O4). Default: false (exact formula).",
    ),
  output_format: z
    .enum(["table", "text"])
    .optional()
    .describe("Format of the result: markdown table or text. Default: table."),
};

/** Maximum number of rows listed in one answer. */
export const MAX_FORMULA_RESULTS = 200;

/** Element symbols, plus "R" (generic group) used in genome-scale models, e.g. C4H6N2O3R2. */
const ELEMENTS = new Set(
  (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se " +
    "Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb " +
    "Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm " +
    "Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og R"
  ).split(" "),
);

export type Composition = Map<string, number>;

/**
 * Parses a molecular formula into element counts: "CH3COOH" → {C: 2, H: 4, O: 2}.
 * Element order, spaces and repeated elements are accepted; a trailing charge
 * sign ("C3H3O4-", "Fe+2") is ignored. Returns undefined if the string is not a formula.
 */
export function parseFormula(value: string): Composition | undefined {
  const s = value.replace(/\s+/g, "").replace(/[+-]+\d*$/, "");
  if (s.length === 0 || !/^([A-Z][a-z]?\d*)+$/.test(s)) return undefined;
  const composition: Composition = new Map();
  for (const [, element, count] of s.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!ELEMENTS.has(element)) return undefined;
    composition.set(element, (composition.get(element) ?? 0) + (count === "" ? 1 : Number(count)));
  }
  return composition;
}

/**
 * True when a search query is most likely a molecular formula rather than a name:
 * it parses as a formula and has a digit or several elements ("CO2", "C3H3O4"),
 * so that names such as "ATP" or "glucose" are not mistaken for formulas.
 */
export function looksLikeFormula(value: string): boolean {
  const composition = parseFormula(value);
  if (!composition) return false;
  return /\d/.test(value) || composition.size >= 2;
}

function sameComposition(a: Composition, b: Composition, ignoreHydrogens: boolean): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    if (ignoreHydrogens && k === "H") continue;
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) return false;
  }
  return true;
}

/** Every metabolite whose chemical_formula has the same composition as `formula`. */
export function findMetabolitesByFormula(
  metabolites: Metabolite[],
  formula: string | Composition,
  opts: { ignoreHydrogens?: boolean } = {},
): Metabolite[] {
  const target = typeof formula === "string" ? parseFormula(formula) : formula;
  if (!target) return [];
  const ignoreH = opts.ignoreHydrogens ?? false;
  return metabolites
    .filter((m) => {
      if (typeof m.chemical_formula !== "string") return false;
      const c = parseFormula(m.chemical_formula);
      return c !== undefined && sameComposition(c, target, ignoreH);
    })
    .sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.compartment?.name ?? "").localeCompare(b.compartment?.name ?? "") ||
        a.id - b.id,
    );
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

/** Text answer listing every metabolite of the network with the given formula. */
export function renderFormulaResult(
  metabolites: Metabolite[],
  formula: string,
  idNetwork: number,
  format: OutputFormat,
  ignoreHydrogens = false,
): string {
  const found = findMetabolitesByFormula(metabolites, formula, { ignoreHydrogens });
  const what = ignoreHydrogens ? `formula ${formula} (hydrogens ignored)` : `formula ${formula}`;
  if (found.length === 0) {
    return (
      `No metabolite with ${what} was found in network ${idNetwork}.` +
      (ignoreHydrogens
        ? ""
        : " Other protonation states can be found with ignore_hydrogens: true.")
    );
  }
  const species = new Set(found.map((m) => m.name)).size;
  const shown = found.slice(0, MAX_FORMULA_RESULTS);
  const parts = [
    `${found.length} metabolite(s) (${species} distinct name(s)) with ${what} in network ${idNetwork}. ` +
      "This is the complete list: every metabolite of the network was checked.",
    `\n${renderRows(format, shown.map(toRow))}`,
  ];
  if (found.length > shown.length) {
    parts.push(`\n${found.length - shown.length} more metabolite(s) not shown.`);
  }
  return parts.join("\n");
}

export function registerSearchMetabolitesByFormula(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "search_metabolites_by_formula",
    {
      title: "Search metabolites by chemical formula in a MetExplore network",
      description:
        "Lists ALL the metabolites of a MetExplore network whose chemical formula matches the given " +
        "molecular formula (element order does not matter: C3H3O4 = H3C3O4). Use this tool whenever " +
        "the user gives a chemical formula such as C6H12O6, C3H3O4 or CO2, instead of search_metabolites " +
        "(which only searches names). The result is exhaustive and lists every match with its id, " +
        "identifier, name, formula, charge, compartment and cross-references. Set ignore_hydrogens to " +
        "also find the other protonation states of the same compound. Requires an id_network (see " +
        "search_organisms).",
      inputSchema: searchMetabolitesByFormulaInputSchema,
    },
    withErrorHandling(async (args, { cache }) => {
      if (!parseFormula(args.formula)) {
        return textResult(
          `"${args.formula}" is not a valid chemical formula. Expected element symbols followed by ` +
            "optional counts, e.g. C3H3O4 or C6H12O6.",
          true,
        );
      }
      const metabolites = await cache.getMetabolites(args.id_network);
      return textResult(
        renderFormulaResult(
          metabolites,
          args.formula,
          args.id_network,
          args.output_format ?? "table",
          args.ignore_hydrogens ?? false,
        ),
      );
    }, ctx),
  );
}
