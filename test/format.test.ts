import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTable, renderText, renderRows } from "../src/format.js";

test("renderTable produces a markdown table with header, separator and rows", () => {
  const out = renderTable([{ a: 1, b: "x" }, { a: 2, b: "y" }]);
  const lines = out.split("\n");
  assert.equal(lines[0], "| a | b |");
  assert.equal(lines[1], "| --- | --- |");
  assert.equal(lines[2], "| 1 | x |");
  assert.equal(lines[3], "| 2 | y |");
});

test("renderTable escapes pipe characters in cell values", () => {
  const out = renderTable([{ a: "x|y" }]);
  assert.ok(out.includes("x\\|y"));
});

test("renderTable on empty rows returns a placeholder", () => {
  assert.equal(renderTable([]), "(no results)");
});

test("renderText numbers each entry and lists column: value pairs", () => {
  const out = renderText([{ a: 1, b: "x" }]);
  assert.equal(out, "1. a: 1, b: x");
});

test("renderRows dispatches to table or text based on format", () => {
  const rows = [{ a: 1 }];
  assert.equal(renderRows("table", rows), renderTable(rows));
  assert.equal(renderRows("text", rows), renderText(rows));
});
