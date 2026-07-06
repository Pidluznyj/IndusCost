/**
 * DTOs e helpers compartilhados do motor Cost-to-Cash Trace.
 */
export type TraceAuditStatus = "PASS" | "FAIL";

/** PUBLISHED = snapshot/materializado; DIAGNOSTIC = recálculo ao vivo (não substitui publicado). */
export type TraceCalculationMode = "PUBLISHED" | "DIAGNOSTIC";

export const TRACE_DIAGNOSTIC_RECALC_NOTE =
  "Recálculo ao vivo — diagnóstico apenas; dado publicado ou materializado tem precedência.";

export type TraceDataSource = {
  field: string;
  source: string;
  note?: string | null;
};

export type TraceChecklist = Record<string, boolean | string>;

export function escapeTraceCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function traceCsvLine(cols: unknown[]): string {
  return cols.map(escapeTraceCsv).join(",");
}

export function appendTraceCsvSection(
  lines: string[],
  section: string,
  rows: Array<[string, unknown] | unknown[]>
): void {
  for (const row of rows) {
    if (Array.isArray(row)) {
      lines.push(traceCsvLine([section, ...row]));
    } else {
      lines.push(traceCsvLine([section, row[0], row[1]]));
    }
  }
}
