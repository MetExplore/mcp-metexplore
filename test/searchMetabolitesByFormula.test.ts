// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMetabolitesByFormula,
  looksLikeFormula,
  parseFormula,
  renderFormulaResult,
} from "../src/tools/searchMetabolitesByFormula.js";
import type { Metabolite } from "../src/apiClient.js";

const m = (id: number, name: string, chemical_formula: string | undefined, compartment: string): Metabolite => ({
  id,
  name,
  db_identifier: `M${id}`,
  chemical_formula,
  compartment: { id: 1, name: compartment },
});

const all: Metabolite[] = [
  m(1, "hydroxypyruvate", "C3H3O4", "Peroxisome"),
  m(2, "hydroxypyruvate", "C3H3O4", "Cytosol"),
  m(3, "2-hydroxy-3-oxopropanoate", "C3H3O4", "Cytosol"),
  m(4, "malonate", "C3H2O4", "Cytosol"),
  m(5, "pyruvate", "C3H3O3", "Cytosol"),
  m(6, "unknown", undefined, "Cytosol"),
  m(7, "pyruvate dehydrogenase", "C4H6N2O3R2", "Cytosol"),
  m(8, "acetate", "C2H3O2", "Cytosol"),
];
const ids = (formula: string, ignoreHydrogens = false) =>
  findMetabolitesByFormula(all, formula, { ignoreHydrogens }).map((x) => x.id);

test("parseFormula counts elements whatever their order or repetition", () => {
  assert.deepEqual(parseFormula("C3H3O4"), new Map([["C", 3], ["H", 3], ["O", 4]]));
  assert.deepEqual(parseFormula("CH3COOH"), new Map([["C", 2], ["H", 4], ["O", 2]]));
  assert.deepEqual(parseFormula(" C3 H3 O4 "), parseFormula("C3H3O4"));
  assert.deepEqual(parseFormula("C3H3O4-"), parseFormula("C3H3O4"));
  assert.deepEqual(parseFormula("C4H6N2O3R2")?.get("R"), 2);
  assert.deepEqual(parseFormula("NaCl"), new Map([["Na", 1], ["Cl", 1]]));
});

test("parseFormula rejects what is not a formula", () => {
  for (const s of ["", "ATP", "glucose", "c3h3o4", "C3H3O4X", "3C"]) {
    assert.equal(parseFormula(s), undefined, s);
  }
});

test("looksLikeFormula separates formulas from names", () => {
  for (const s of ["C3H3O4", "CO2", "H2O", "C6H12O6", "NaCl"]) assert.ok(looksLikeFormula(s), s);
  for (const s of ["pyruvate", "ATP", "CoA", "glc__D_c", "C", "P"]) assert.ok(!looksLikeFormula(s), s);
});

test("finds every metabolite with the exact formula, in any element order", () => {
  assert.deepEqual(ids("C3H3O4"), [3, 2, 1]);
  assert.deepEqual(ids("O4H3C3"), [3, 2, 1]);
  assert.deepEqual(ids("C3H2O4"), [4]);
  assert.deepEqual(ids("C4H6N2O3R2"), [7]);
  assert.deepEqual(ids("C9H9"), []);
});

test("ignore_hydrogens matches every protonation state", () => {
  assert.deepEqual(ids("C3H4O4", true), [3, 2, 1, 4]);
  assert.deepEqual(ids("C3H4O4"), []);
});

test("renderFormulaResult lists all matches or explains the absence", () => {
  const text = renderFormulaResult(all, "C3H3O4", 212, "table");
  assert.match(text, /^3 metabolite\(s\) \(2 distinct name\(s\)\)/);
  assert.match(text, /hydroxypyruvate/);
  assert.doesNotMatch(text, /malonate/);
  assert.match(renderFormulaResult(all, "C9H9", 212, "text"), /No metabolite.*ignore_hydrogens/);
});
