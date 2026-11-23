// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectDatabases,
  findMetabolitesByExternalId,
  normalizeExtId,
  renderExternalIdResult,
  resolveDatabase,
} from "../src/tools/searchMetabolitesByExternalId.js";
import type { Metabolite } from "../src/apiClient.js";

const m = (id: number, name: string, compartment: string, refs: [string, string][]): Metabolite => ({
  id,
  name,
  db_identifier: `M${id}`,
  compartment: { id: 1, name: compartment },
  cross_refs: refs.map(([ext_db_name, ext_id]) => ({ ext_db_name, ext_id })),
});

const all: Metabolite[] = [
  m(1, "ATP", "Cytosol", [["chebi", "CHEBI:30616"], ["kegg.compound", "C00002"], ["bigg.metabolite", "atp"]]),
  m(2, "ATP", "Mitochondria", [["chebi", "CHEBI:30616"], ["hmdb", "HMDB0000538"]]),
  m(3, "ADP", "Cytosol", [["chebi", "CHEBI:456216"], ["kegg.compound", "C00008"]]),
  m(4, "glucose", "Cytosol", []),
];

const stats = { chebi: 3633, "kegg.compound": 3838, hmdb: 2179, "bigg.metabolite": 5292, "pubchem.compound": 3624 };
const available = Object.keys(stats);
const dbs = (id: string, av = available) => detectDatabases(id, av).map((c) => c.db);

test("detectDatabases recognizes identifier types", () => {
  assert.deepEqual(dbs("CHEBI:15422"), ["chebi"]);
  assert.deepEqual(dbs("C00002"), ["kegg.compound"]);
  assert.deepEqual(dbs("HMDB0000538"), ["hmdb"]);
  assert.deepEqual(dbs("MNXM3"), ["metanetx.chemical"]);
  assert.deepEqual(dbs("LMFA01010001"), ["lipidmaps"]);
  assert.deepEqual(dbs("15422"), ["chebi", "pubchem.compound"]);
  assert.deepEqual(dbs("glc__D"), []);
});

test("detectDatabases honors an explicit db prefix and aliases", () => {
  assert.deepEqual(detectDatabases("kegg.compound:C00002", available), [{ db: "kegg.compound", id: "C00002" }]);
  assert.deepEqual(detectDatabases("bigg.metabolite:atp", available), [{ db: "bigg.metabolite", id: "atp" }]);
  assert.deepEqual(detectDatabases("kegg:C00002", available), [{ db: "kegg.compound", id: "C00002" }]);
  // "CHEBI:" is both a prefix and part of the identifier.
  assert.deepEqual(dbs("CHEBI:15422", ["kegg.compound"]), ["chebi"]);
});

test("normalizeExtId makes equivalent forms comparable", () => {
  assert.equal(normalizeExtId("chebi", "15422"), normalizeExtId("chebi", "CHEBI:15422"));
  assert.equal(normalizeExtId("hmdb", "HMDB00538"), normalizeExtId("hmdb", "HMDB0000538"));
  assert.equal(normalizeExtId("kegg.compound", "c00002"), normalizeExtId("kegg.compound", "C00002"));
});

test("findMetabolitesByExternalId returns every compartment", () => {
  const ids = (db: string, id: string) => findMetabolitesByExternalId(all, db, id).map((x) => x.id);
  assert.deepEqual(ids("chebi", "CHEBI:30616"), [1, 2]);
  assert.deepEqual(ids("chebi", "30616"), [1, 2]);
  assert.deepEqual(ids("hmdb", "HMDB00538"), [2]);
  assert.deepEqual(ids("kegg.compound", "C00002"), [1]);
  assert.deepEqual(ids("kegg.compound", "C99999"), []);
  // The database must match, not only the identifier.
  assert.deepEqual(ids("hmdb", "C00002"), []);
});

test("resolveDatabase checks the network contains the database", () => {
  const r = resolveDatabase("CHEBI:15422", undefined, { "kegg.compound": 10 }, 7);
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /no chebi cross-reference/);
  assert.match((r as { message: string }).message, /kegg\.compound \(10\)/);
});

test("resolveDatabase asks the user when the identifier is unknown or ambiguous", () => {
  const unknown = resolveDatabase("glc__D", undefined, stats, 7);
  assert.equal(unknown.ok, false);
  assert.match((unknown as { message: string }).message, /not recognized.*Ask the user/s);
  assert.match((unknown as { message: string }).message, /bigg\.metabolite \(5292\)/);

  const ambiguous = resolveDatabase("15422", undefined, stats, 7);
  assert.equal(ambiguous.ok, false);
  assert.match((ambiguous as { message: string }).message, /chebi, pubchem\.compound/);

  // Only one candidate database in the network: no question.
  assert.deepEqual(resolveDatabase("15422", undefined, { chebi: 1 }, 7), { ok: true, db: "chebi", id: "15422" });
});

test("resolveDatabase accepts an explicit db", () => {
  assert.deepEqual(resolveDatabase("glc__D", "BIGG.metabolite", stats, 7), {
    ok: true,
    db: "bigg.metabolite",
    id: "glc__D",
  });
  assert.deepEqual(resolveDatabase("kegg.compound:C00002", "kegg.compound", stats, 7), {
    ok: true,
    db: "kegg.compound",
    id: "C00002",
  });
  const missing = resolveDatabase("LMFA01010001", "lipidmaps", stats, 7);
  assert.equal(missing.ok, false);
});

test("renderExternalIdResult lists matches or says none was found", () => {
  const text = renderExternalIdResult(all, "chebi", "CHEBI:30616", 7, "table");
  assert.match(text, /^2 metabolite\(s\) \(1 distinct name\(s\)\)/);
  assert.match(text, /Mitochondria/);
  assert.match(renderExternalIdResult(all, "chebi", "CHEBI:1", 7, "table"), /^No metabolite/);
});
