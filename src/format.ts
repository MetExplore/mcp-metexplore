export type OutputFormat = "table" | "text";

/** Renders a list of homogeneous objects as a markdown table. */
export function renderTable(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "(no results)";
  const cols = columns ?? Object.keys(rows[0]);
  const cell = (v: unknown) => (v === undefined || v === null ? "" : String(v).replace(/\|/g, "\\|"));
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`).join("\n");
  return [header, sep, body].join("\n");
}

/** Renders a list of homogeneous objects as text, one entry per line. */
export function renderText(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "(no results)";
  const cols = columns ?? Object.keys(rows[0]);
  return rows
    .map((r, i) => `${i + 1}. ${cols.map((c) => `${c}: ${r[c] ?? ""}`).join(", ")}`)
    .join("\n");
}

export function renderRows(format: OutputFormat, rows: Record<string, unknown>[], columns?: string[]): string {
  return format === "table" ? renderTable(rows, columns) : renderText(rows, columns);
}
