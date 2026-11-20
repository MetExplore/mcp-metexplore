import { test } from "node:test";
import assert from "node:assert/strict";
import { findMetaboliteCandidates, normalizeName } from "../src/tools/searchMetabolites.js";
import type { Metabolite } from "../src/apiClient.js";

const m = (id: number, name: string, db_identifier: string): Metabolite => ({ id, name, db_identifier });

const all: Metabolite[] = [
  m(1, "D-glucose", "glc__D_c"),
  m(2, "D-glucose", "glc__D_e"),
  m(3, "L-glucose", "glc__L_c"),
  m(4, "glucose 6-phosphate", "g6p_c"),
  m(5, "beta-alanine", "ala_B_c"),
  m(6, "ATP", "atp_c"),
  m(7, "CO2", "co2_c"),
  m(8, "pyruvate", "pyr_c"),
  m(9, "phosphoenolpyruvate", "pep_c"),
  m(10, "galactose", "gal_c"),
];
const ids = (q: string) => findMetaboliteCandidates(all, q).map((c) => c.metabolite.id);

test("normalization handles case, accents, punctuation and Greek letters", () => {
  assert.deepEqual(normalizeName("β-D-Glucose").tokens, ["beta", "d", "glucose"]);
  assert.equal(normalizeName("Écarlate (E)").compact, "ecarlatee");
});

test("an exact name in several compartments is ambiguous, exact matches first", () => {
  const found = findMetaboliteCandidates(all, "D-glucose");
  assert.deepEqual(found.slice(0, 2).map((c) => c.metabolite.id), [1, 2]);
  assert.ok(found.slice(0, 2).every((c) => c.match === "exact"));
  assert.ok(found.length > 2, "close names (L-glucose) are also proposed");
  assert.ok(found.some((c) => c.metabolite.id === 3));
});

test("a word query lists every name containing it", () => {
  assert.deepEqual(ids("glucose").sort(), [1, 2, 3, 4]);
});

test("typos are tolerated", () => {
  assert.deepEqual(ids("glucoze").sort(), [1, 2, 3, 4]);
  assert.deepEqual(ids("piruvate")[0], 8);
});

test("Greek letters, separators and word order do not matter", () => {
  assert.deepEqual(ids("β-alanine"), [5]);
  assert.deepEqual(ids("beta alanine"), [5]);
  assert.deepEqual(ids("alanine beta"), [5]);
});

test("a single close match is returned alone", () => {
  assert.deepEqual(ids("Pyruvate").includes(8), true);
  assert.deepEqual(ids("phosphoenol pyruvate"), [9]);
});

test("db_identifier is searched too", () => {
  assert.deepEqual(ids("glc__D_c"), [1]);
  assert.deepEqual(ids("g6p"), [4]);
});

test("far-fetched matches are discarded", () => {
  assert.deepEqual(ids("xyzzy"), []);
  assert.deepEqual(ids("citrate"), []);
  assert.deepEqual(ids("fructose"), []);
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("--"), []);
});

test("short queries do not produce fuzzy noise", () => {
  assert.deepEqual(ids("ATP"), [6]);
  assert.deepEqual(ids("CO2"), [7]);
  assert.deepEqual(ids("AT"), [], "2-character queries are too short to match anything");
});
