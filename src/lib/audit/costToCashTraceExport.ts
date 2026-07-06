import {
  assertExportableDossier,
  buildCostToCashTraceDossierCsv,
  buildCostToCashTraceDossierJson,
  CostToCashTraceDossierError,
  formatDiagnosticsForClipboard,
  resolveDossierFilenamePrefix,
} from "./costToCashTraceDossier.js";
import type { CostToCashTraceApiPayloadInput } from "./costToCashTraceDossierMapper.js";
import type { CostToCashTraceSearchFilters } from "./costToCashTraceClient.js";

export { CostToCashTraceDossierError };

function downloadBlob(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function downloadTraceJson(payload: unknown, filenamePrefix = "cost-to-cash-trace"): void {
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${filenamePrefix}-${stampSuffix()}.json`
  );
}

export function downloadTraceCsv(csv: string, filenamePrefix = "cost-to-cash-trace"): void {
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filenamePrefix}-${stampSuffix()}.csv`);
}

export function exportCostToCashDossierJson(
  payload: CostToCashTraceApiPayloadInput,
  filters: CostToCashTraceSearchFilters | null
): void {
  assertExportableDossier(payload);
  const dossier = buildCostToCashTraceDossierJson(payload, filters);
  const prefix = resolveDossierFilenamePrefix(payload, filters);
  downloadTraceJson(dossier, prefix);
}

export function exportCostToCashDossierCsv(
  payload: CostToCashTraceApiPayloadInput,
  filters: CostToCashTraceSearchFilters | null
): void {
  assertExportableDossier(payload);
  const csv = buildCostToCashTraceDossierCsv(payload);
  const prefix = resolveDossierFilenamePrefix(payload, filters);
  downloadTraceCsv(csv, prefix);
}

export async function copyCostToCashDiagnostics(
  payload: CostToCashTraceApiPayloadInput
): Promise<string> {
  assertExportableDossier(payload);
  const text = formatDiagnosticsForClipboard(payload);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
  return text;
}
