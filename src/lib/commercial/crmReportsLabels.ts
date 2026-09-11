/**
 * Rótulos de CRM > Relatórios — fonte única para UI e exportação.
 *
 * Módulo puro (frontend-safe). Só TRADUZ o que o motor já calculou
 * (`status`, `deltaDays`, `cadenceConfidence`); nenhuma data ou status é
 * derivado aqui. Nunca depende só de cor: todo status tem texto explícito.
 */

import type {
  CrmCadenceConfidence,
  CrmReportsOverdueSeverity,
  CrmReportsOverdueSort,
  CrmRepurchaseStatus,
} from "@/src/lib/commercial/crmReportsTypes.js";

export const CRM_REPURCHASE_STATUS_LABELS: Record<CrmRepurchaseStatus, string> = {
  NO_HISTORY: "Sem histórico",
  INSUFFICIENT_HISTORY: "Sem cadência suficiente",
  ON_TIME: "Em dia",
  DUE_SOON: "Recompra próxima",
  OVERDUE: "Atrasado",
  SEVERELY_OVERDUE: "Muito atrasado",
};

export const CRM_CADENCE_CONFIDENCE_LABELS: Record<CrmCadenceConfidence, string> = {
  NONE: "Sem histórico",
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

export const CRM_CADENCE_CONFIDENCE_HINTS: Record<CrmCadenceConfidence, string> = {
  NONE: "Menos de 2 ocasiões de compra — sem histórico suficiente para prever.",
  LOW: "2 ocasiões de compra (1 intervalo).",
  MEDIUM: "3 ou 4 ocasiões de compra.",
  HIGH: "5 ou mais ocasiões de compra.",
};

function days(n: number): string {
  return n === 1 ? "1 dia" : `${n} dias`;
}

/**
 * Situação legível a partir do status e do desvio do motor.
 *   ON_TIME           → "Em dia · recompra em 22 dias"
 *   DUE_SOON          → "Recompra em 8 dias" | "Recompra prevista para hoje"
 *   OVERDUE           → "Atrasado · 17 dias"
 *   SEVERELY_OVERDUE  → "Muito atrasado · 45 dias"
 *   INSUFFICIENT      → "Sem cadência suficiente" (nunca uma previsão falsa)
 */
export function formatCrmRepurchaseSituation(
  status: CrmRepurchaseStatus,
  deltaDays: number | null
): string {
  switch (status) {
    case "ON_TIME":
      return deltaDays != null ? `Em dia · recompra em ${days(-deltaDays)}` : CRM_REPURCHASE_STATUS_LABELS.ON_TIME;
    case "DUE_SOON":
      if (deltaDays == null) return CRM_REPURCHASE_STATUS_LABELS.DUE_SOON;
      return deltaDays === 0 ? "Recompra prevista para hoje" : `Recompra em ${days(-deltaDays)}`;
    case "OVERDUE":
      return deltaDays != null ? `Atrasado · ${days(deltaDays)}` : CRM_REPURCHASE_STATUS_LABELS.OVERDUE;
    case "SEVERELY_OVERDUE":
      return deltaDays != null
        ? `Muito atrasado · ${days(deltaDays)}`
        : CRM_REPURCHASE_STATUS_LABELS.SEVERELY_OVERDUE;
    default:
      return CRM_REPURCHASE_STATUS_LABELS[status];
  }
}

/** Desvio em relação à data esperada: "+12 d" (atrasado) / "−8 d" (antes) / "0 d". */
export function formatCrmRepurchaseDeviation(deltaDays: number | null): string {
  if (deltaDays == null) return "—";
  if (deltaDays > 0) return `+${deltaDays} d`;
  if (deltaDays < 0) return `−${Math.abs(deltaDays)} d`;
  return "0 d";
}

export const CRM_REPORTS_OVERDUE_SORT_LABELS: Record<CrmReportsOverdueSort, string> = {
  DELAY_DESC: "Maior atraso primeiro",
  VALUE_12M_DESC: "Maior venda 12m primeiro",
};

export const CRM_REPORTS_OVERDUE_SEVERITY_LABELS: Record<CrmReportsOverdueSeverity, string> = {
  ALL: "Todos os atrasados",
  SEVERE: "Só atrasados > 30 dias",
};
