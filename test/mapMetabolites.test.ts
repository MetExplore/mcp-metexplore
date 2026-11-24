// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMappingReport } from "../src/tools/mapMetabolites.js";
import type { Metabolite, MappingResponse } from "../src/apiClient.js";

const metabolites: Metabolite[] = [
  { id: 1, db_identifier: "M_glc__D_c", name: "D-Glucose", chemical_formula: "C6H12O6" },
  { id: 2, db_identifier: "M_adp_c", name: "ADP (cytosol)", chemical_formula: "C10H15N5O10P2" },
  { id: 3, db_identifier: "M_adp_m", name: "ADP (mitochondria)", chemical_formula: "C10H15N5O10P2" },
];

test("buildMappingReport separates mapped, unmapped and ambiguous entries", () => {
  const mapping: MappingResponse = {
    map: {
      "M_glc__D_c": ["M_glc__D_c"],
      "M_adp.*": ["M_adp_c", "M_adp_m"],
    },
    entities: {},
    statistics: {
      nb_queries: 3,
      nb_mapped_queries: 2,
      enrichment: {
        glycolysis: {
          label: "Glycolysis",
          nb_total_biodata: 10,
          nb_mapped_biodata: 2,
          pval: 0.01,
          bonferroni_pval: 0.02,
          bh_pval: 0.015,
        },
        tca: {
          label: "TCA cycle",
          nb_total_biodata: 8,
          nb_mapped_biodata: 1,
          pval: 0.5,
          bonferroni_pval: 1,
          bh_pval: 0.5,
        },
      },
    },
  };

  const { text: report } = buildMappingReport(
    42,
    ["M_glc__D_c", "M_adp.*", "M_noway_c"],
    mapping,
    metabolites,
    "table",
  );

  assert.match(report, /2\/3 identifier\(s\) mapped/);
  assert.match(report, /1 not found/);
  assert.match(report, /1 ambiguous/);
  assert.match(report, /M_noway_c/);
  assert.match(report, /ADP \(cytosol\)/);
  assert.match(report, /ADP \(mitochondria\)/);
  assert.match(report, /Pathway enrichment/);
  assert.match(report, /Glycolysis/);
  assert.match(report, /TCA cycle/);
  // Glycolysis (bh_pval 0.015) must be listed before TCA cycle (bh_pval 0.5).
  assert.ok(report.indexOf("Glycolysis") < report.indexOf("TCA cycle"));
});

test("buildMappingReport renders as plain text when requested", () => {
  const mapping: MappingResponse = {
    map: { "M_glc__D_c": ["M_glc__D_c"] },
    entities: {},
    statistics: { nb_queries: 1, nb_mapped_queries: 1, enrichment: {} },
  };
  const { text: report } = buildMappingReport(1, ["M_glc__D_c"], mapping, metabolites, "text");
  assert.match(report, /1\. entry: M_glc__D_c, db_identifier: M_glc__D_c/);
});

test("buildMappingReport returns structured data with resolved pathway ids", () => {
  const mapping: MappingResponse = {
    map: { "M_glc__D_c": ["M_glc__D_c"], "M_adp.*": ["M_adp_c", "M_adp_m"] },
    entities: {},
    statistics: {
      nb_queries: 3,
      nb_mapped_queries: 2,
      enrichment: {
        "Citric Acid Cycle": {
          label: "Citric Acid Cycle",
          nb_total_biodata: 10,
          nb_mapped_biodata: 1,
          pval: 0.5,
          bonferroni_pval: 1,
          bh_pval: 0.5,
        },
        "Glycolysis/Gluconeogenesis": {
          label: "Glycolysis/Gluconeogenesis",
          nb_total_biodata: 12,
          nb_mapped_biodata: 2,
          pval: 0.01,
          bonferroni_pval: 0.02,
          bh_pval: 0.015,
        },
        Unknown: {
          label: "Unknown",
          nb_total_biodata: 3,
          nb_mapped_biodata: 1,
          pval: 0.9,
          bonferroni_pval: 1,
          bh_pval: 0.9,
        },
      },
    },
  };
  const pathways = [
    { id: 2, name: "Glycolysis/Gluconeogenesis", db_identifier: "Glycolysis/Gluconeogenesis" },
    { id: 8, name: "Citric Acid Cycle", db_identifier: "Citric Acid Cycle" },
  ];

  const { text, structured } = buildMappingReport(
    1,
    ["M_glc__D_c", "M_adp.*", "M_noway_c"],
    mapping,
    metabolites,
    "table",
    pathways,
  );

  assert.equal(structured.kind, "metabolite_mapping");
  assert.equal(structured.id_network, 1);
  assert.deepEqual(structured.mapped, [{ entry: "M_glc__D_c", db_identifier: "M_glc__D_c" }]);
  assert.deepEqual(structured.not_found, ["M_noway_c"]);
  assert.deepEqual(structured.ambiguous, [{ entry: "M_adp.*", db_identifiers: ["M_adp_c", "M_adp_m"] }]);
  assert.deepEqual(
    structured.pathways.map((p) => [p.name, p.id]),
    [
      ["Glycolysis/Gluconeogenesis", 2],
      ["Citric Acid Cycle", 8],
      ["Unknown", null],
    ],
  );
  // the pathway id is also given to the LLM, in the enrichment table
  assert.match(text, /\| id \|/);
});
