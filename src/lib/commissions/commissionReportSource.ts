/**
 * Fonte oficial de relatórios PAYABLE — lógica pura.
 *
 * Regra: fechamento RECEIPT_BASED CLOSED > prévia por schedule materializado > legado (visual audit).
 */
export type CommissionReportSourceMode = "auto" | "receipt" | "legacy";

export type CommissionReportDataSource =
  | "RECEIPT_CLOSED"
  | "RECEIPT_PREVIEW"
  | "LEGACY_VISUAL_AUDIT";

export type CommissionReportStatus = "FECHADO" | "PREVIEW" | "LEGADO";

export type CommissionReportSourceMeta = {
  sourceMode: CommissionReportSourceMode;
  dataSource: CommissionReportDataSource;
  reportStatus: CommissionReportStatus;
  closingId: string | null;
  calculationHash: string | null;
  deprecationNotice: string | null;
  warnings: string[];
};

export const LEGACY_PAYABLE_DEPRECATION_NOTICE =
  "Este relatório usa cálculo legado (CommissionRecord/CommissionPaymentSchedule). Para pagamento oficial use Fechamento por Recebimento.";

export const RECEIPT_PREVIEW_WARNING =
  "Prévia não fechada — comissão liberada a partir de CommissionReceivableSchedule materializado (fallback por item apenas com flag explícita).";

export const RECEIPT_CLOSED_NOTICE =
  "Fonte oficial: ledger RECEIPT_BASED fechado para o período.";

export function parseCommissionReportSourceMode(
  raw: string | null | undefined
): CommissionReportSourceMode {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (value === "receipt" || value === "legacy" || value === "auto") return value;
  throw new Error(`--source inválido: ${raw}. Use auto, receipt ou legacy.`);
}

export function buildReceiptClosedMeta(input: {
  sourceMode: CommissionReportSourceMode;
  closingId: string;
  calculationHash: string | null;
}): CommissionReportSourceMeta {
  return {
    sourceMode: input.sourceMode,
    dataSource: "RECEIPT_CLOSED",
    reportStatus: "FECHADO",
    closingId: input.closingId,
    calculationHash: input.calculationHash,
    deprecationNotice: null,
    warnings: [RECEIPT_CLOSED_NOTICE],
  };
}

export function buildReceiptPreviewMeta(
  sourceMode: CommissionReportSourceMode
): CommissionReportSourceMeta {
  return {
    sourceMode,
    dataSource: "RECEIPT_PREVIEW",
    reportStatus: "PREVIEW",
    closingId: null,
    calculationHash: null,
    deprecationNotice: null,
    warnings: [RECEIPT_PREVIEW_WARNING],
  };
}

export function buildLegacyPayableMeta(
  sourceMode: CommissionReportSourceMode
): CommissionReportSourceMeta {
  return {
    sourceMode,
    dataSource: "LEGACY_VISUAL_AUDIT",
    reportStatus: "LEGADO",
    closingId: null,
    calculationHash: null,
    deprecationNotice: LEGACY_PAYABLE_DEPRECATION_NOTICE,
    warnings: [LEGACY_PAYABLE_DEPRECATION_NOTICE],
  };
}

export function mergeReportWarnings(
  meta: CommissionReportSourceMeta,
  existingWarnings: string[]
): string[] {
  const merged = new Set<string>([...meta.warnings, ...existingWarnings]);
  if (meta.deprecationNotice) merged.add(meta.deprecationNotice);
  return [...merged];
}

export function formatReportSourceCsvHeaders(meta: CommissionReportSourceMeta): string[] {
  return [
    `# report_source=${meta.dataSource}`,
    `# report_status=${meta.reportStatus}`,
    `# source_mode=${meta.sourceMode}`,
    meta.closingId ? `# closing_id=${meta.closingId}` : "# closing_id=",
    meta.calculationHash ? `# calculation_hash=${meta.calculationHash}` : "# calculation_hash=",
    meta.deprecationNotice ? `# deprecation=${meta.deprecationNotice}` : "",
  ].filter(Boolean);
}

export function formatReportSourceLabel(meta: CommissionReportSourceMeta): string {
  if (meta.reportStatus === "FECHADO") return "FECHADO (ledger RECEIPT_BASED)";
  if (meta.reportStatus === "PREVIEW") return "PREVIEW (não fechada)";
  return "LEGADO (visual audit)";
}
