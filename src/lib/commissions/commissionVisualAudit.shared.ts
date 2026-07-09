export type VisualAuditAppraisalMode = "GENERATED" | "FORECAST" | "PAYABLE";

export const VISUAL_AUDIT_APPRAISAL_MODES: VisualAuditAppraisalMode[] = [
  "GENERATED",
  "FORECAST",
  "PAYABLE",
];

export const VISUAL_AUDIT_MODE_LABELS: Record<VisualAuditAppraisalMode, string> = {
  GENERATED: "Gerada (secundária)",
  FORECAST: "Prevista (secundária)",
  PAYABLE: "Fechamento por recebimento",
};

export const VISUAL_AUDIT_MODE_DESCRIPTIONS: Record<VisualAuditAppraisalMode, string> = {
  GENERATED:
    "Visão secundária por comissão gerada (confirmedAt da NF). Não substitui a auditoria do fechamento.",
  FORECAST:
    "Visão secundária por títulos em aberto (dueDate). Use a aba Previsão para o fluxo oficial.",
  PAYABLE:
    "Auditoria oficial do fechamento: títulos baixados no mês (settlementDate), mesmas regras e totais do Fechamento do mês.",
};

export function parseVisualAuditAppraisalMode(
  value: unknown
): VisualAuditAppraisalMode {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "FORECAST" || raw === "PREVISTA" || raw === "PREVIEW") return "FORECAST";
  if (raw === "PAYABLE" || raw === "PAGAR" || raw === "PAGO") return "PAYABLE";
  if (raw === "GENERATED" || raw === "GERADA") return "GENERATED";
  return "PAYABLE";
}
