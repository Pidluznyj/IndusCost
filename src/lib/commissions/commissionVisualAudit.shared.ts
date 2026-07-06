export type VisualAuditAppraisalMode = "GENERATED" | "FORECAST" | "PAYABLE";

export const VISUAL_AUDIT_APPRAISAL_MODES: VisualAuditAppraisalMode[] = [
  "GENERATED",
  "FORECAST",
  "PAYABLE",
];

export const VISUAL_AUDIT_MODE_LABELS: Record<VisualAuditAppraisalMode, string> = {
  GENERATED: "Gerada",
  FORECAST: "Prevista / A liberar",
  PAYABLE: "A pagar no mês",
};

export const VISUAL_AUDIT_MODE_DESCRIPTIONS: Record<VisualAuditAppraisalMode, string> = {
  GENERATED:
    "Comissão gerada por vendas/faturamentos do período (data da NF/documento ou pedido).",
  FORECAST:
    "Comissão calculada em títulos em aberto ou futuros, ainda dependente de recebimento.",
  PAYABLE:
    "Comissão liberada em títulos baixados/recebidos no período (settlementDate do CR). Comparável ao Nomus mensal.",
};

export function parseVisualAuditAppraisalMode(
  value: unknown
): VisualAuditAppraisalMode {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "FORECAST" || raw === "PREVISTA" || raw === "PREVIEW") return "FORECAST";
  if (raw === "PAYABLE" || raw === "PAGAR" || raw === "PAGO") return "PAYABLE";
  return "GENERATED";
}
