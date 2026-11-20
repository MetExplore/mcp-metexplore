import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChebiId, renderChebiMatchReport, type ChebiQuery } from "../src/tools/matchChebi.js";
import type { ChebiMatchResult } from "../src/apiClient.js";

test("normalizeChebiId accepts prefixed and bare ChEBI identifiers", () => {
  assert.equal(normalizeChebiId("CHEBI:17234"), "chebi:17234");
  assert.equal(normalizeChebiId(" chebi:15377 "), "chebi:15377");
  assert.equal(normalizeChebiId("17234"), "chebi:17234");
  assert.equal(normalizeChebiId("C00031"), undefined);
  assert.equal(normalizeChebiId("CHEBI:abc"), undefined);
});

const queries: ChebiQuery[] = [
  { input: "CHEBI:17234", chebi: "chebi:17234" },
  { input: "CHEBI:99999", chebi: "chebi:99999" },
];

const results: ChebiMatchResult[] = [
  {
    external_identifier: "chebi:17234",
    external_identifier_name: "glucose",
    name: "CHEBI:17234",
    matching_results: [
      {
        id: 2,
        db_identifier: "M_glc__D_c",
        name: "D-glucose",
        external_identifier: "CHEBI:4167",
        external_identifier_name: "D-glucopyranose",
        distance: 2,
        relations: ["parent-to-child"],
        compartments: [{ id: 1, name: "cytosol", db_identifier: "c" }],
      },
      {
        id: 1,
        db_identifier: "M_glc_c",
        name: "glucose",
        external_identifier: "CHEBI:17234",
        external_identifier_name: "glucose",
        distance: 0,
        relations: ["exact"],
        compartments: [
          { id: 1, name: "cytosol", db_identifier: "c" },
          { id: 2, name: "extracellular", db_identifier: "e" },
        ],
      },
    ],
  },
  { external_identifier: "chebi:99999", name: "CHEBI:99999", matching_results: [] },
];

test("renderChebiMatchReport sorts matches by distance and lists unmatched ChEBI", () => {
  const report = renderChebiMatchReport(queries, ["C00031"], results, 42, "table");
  assert.match(report, /network 42: 1\/2 ChEBI identifier\(s\) matched, 1 without any match/);
  assert.match(report, /\*\*CHEBI:17234 \(glucose\)\*\*: 2 matching metabolite\(s\), 1 exact/);
  assert.ok(report.indexOf("M_glc_c") < report.indexOf("M_glc__D_c"), "exact match listed first");
  assert.match(report, /cytosol, extracellular/);
  assert.match(report, /parent-to-child/);
  assert.match(report, /CHEBI:4167 \| D-glucopyranose/);
  assert.match(report, /\*\*Not matched:\*\*\n- CHEBI:99999/);
  assert.match(report, /Not ChEBI identifiers \(ignored\):\*\*\n- C00031/);
  assert.match(report, /Relations/);
});

test("renderChebiMatchReport finds results by ChEBI number when the name differs", () => {
  const report = renderChebiMatchReport(
    [{ input: "17234", chebi: "chebi:17234" }],
    [],
    [{ ...results[0], name: "something else", external_identifier: "CHEBI:17234" }],
    1,
    "text",
  );
  assert.match(report, /1\/1 ChEBI identifier\(s\) matched/);
  assert.match(report, /1\. id: 1, db_identifier: M_glc_c/);
});
