export function fleetCsvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function fleetRowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(fleetCsvEscape).join(";")];
  for (const row of rows) {
    lines.push(row.map(fleetCsvEscape).join(";"));
  }
  return "\uFEFF" + lines.join("\n");
}
