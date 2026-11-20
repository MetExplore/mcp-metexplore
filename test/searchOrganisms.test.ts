import { test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../src/tools/searchOrganisms.js";
import type { Network } from "../src/apiClient.js";

const humanGemV1: Network = {
  id: 3,
  name: "Homo sapiens - Human-Gem",
  organism_name: "Homo sapiens",
  version: "1.19.0",
  db_identifier: "HumanGEM",
  identifier_origin: "Human-GEM",
  description: "Human_GEM ... Publication: https://doi.org/10.1126/scisignal.aaz1482",
};
const humanGemV2: Network = {
  id: 212,
  name: "Homo sapiens - Human-Gem",
  organism_name: "Homo sapiens",
  version: "2.0",
  db_identifier: "HumanGEM-V2",
  identifier_origin: "",
  description: "Human_GEM V2 ...",
};
const yeast: Network = {
  id: 7,
  name: "Saccharomyces cerevisiae - Yeast8",
  organism_name: "Saccharomyces cerevisiae",
  version: "12.0",
  db_identifier: "yeastGEM",
};
const all = [humanGemV1, humanGemV2, yeast];
const ids = (q: string) => all.filter((n) => matches(n, q)).map((n) => n.id);

test("matching ignores case and punctuation", () => {
  assert.deepEqual(ids("human-gem"), [3, 212]);
  assert.deepEqual(ids("HUMANGEM"), [3, 212]);
  assert.deepEqual(ids("Homo sapiens"), [3, 212]);
});

test("a version word filters on the model version", () => {
  assert.deepEqual(ids("human-gem 2"), [212]);
  assert.deepEqual(ids("Human-GEM v2"), [212]);
  assert.deepEqual(ids("human-gem 1.19"), [3]);
  assert.deepEqual(ids("human-gem 1"), [3]);
  assert.deepEqual(ids("human-gem 3"), []);
});

test("version matching is segment-based, not substring-based", () => {
  assert.deepEqual(ids("yeast 2"), []);
  assert.deepEqual(ids("yeast 12"), [7]);
});

test("db_identifier with version suffix matches directly", () => {
  assert.deepEqual(ids("HumanGEM-V2"), [212]);
});

test("a query made only of version-like words is matched as text", () => {
  assert.deepEqual(ids("1482"), [3]);
  assert.deepEqual(ids(""), []);
});
