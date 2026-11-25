// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeneMappingReport } from "../src/tools/mapGenes.js";
import type { MappingResponse } from "../src/apiClient.js";

test("buildGeneMappingReport separates mapped, unmapped and ambiguous genes with enrichment", () => {
  const mapping: MappingResponse = {
    map: { b0001: ["b0001"], "b00.*": ["b0002", "b0003"] },
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
      },
    },
  };
  const pathways = [{ id: 2, name: "Glycolysis/Gluconeogenesis", db_identifier: "Glycolysis/Gluconeogenesis" }];

  const { text, structured } = buildGeneMappingReport(7, ["b0001", "b00.*", "nope"], mapping, "table", pathways);

  assert.match(text, /Gene mapping report on network 7: 2\/3 identifier\(s\) mapped/);
  assert.match(text, /1 not found, 1 ambiguous/);
  assert.match(text, /several matching genes/);
  assert.match(text, /b0003/);
  assert.ok(text.indexOf("Glycolysis/Gluconeogenesis") < text.indexOf("Citric Acid Cycle"));

  assert.equal(structured.kind, "gene_mapping");
  assert.deepEqual(structured.mapped, [{ entry: "b0001", db_identifier: "b0001" }]);
  assert.deepEqual(structured.not_found, ["nope"]);
  assert.deepEqual(structured.ambiguous, [{ entry: "b00.*", db_identifiers: ["b0002", "b0003"] }]);
  assert.deepEqual(
    structured.pathways.map((p) => [p.name, p.id]),
    [
      ["Glycolysis/Gluconeogenesis", 2],
      ["Citric Acid Cycle", null],
    ],
  );
});
