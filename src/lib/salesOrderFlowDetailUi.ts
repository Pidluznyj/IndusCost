/**
 * Helpers UI do drawer de detalhe do Fluxo de Pedidos (browser-safe).
 */
import { HttpError } from "@/src/lib/http.js";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  SALES_ORDER_FLOW_STAGE_LABELS,
  isSalesOrderFlowStage,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog.js";
import type { SalesOrderFlowDetailPayload } from "@/src/lib/sales/salesOrderFlowDetail.js";
import type { SalesOrderFlowListInconsistency } from "@/src/lib/sales/salesOrderFlowList.js";
import { formatCurrency } from "@/src/lib/utils.js";

export type SalesOrderFlowDetailTab = "resumo" | "itens";

export type SalesOrderFlowDetailItemView = {
  salesOrderItemId: string;
  productLabel: string;
  orderedQuantity: number | null;
  progressProductionOrder: number | null;
  progressProduced: number | null;
  progressDocumented: number | null;
  progressInvoiced: number | null;
  progressShipped: number | null;
  activeRemainingQuantity: number | null;
  cutQuantity: number | null;
  currentStage: string | null;
  stageLabel: string;
  nextAction: string | null;
  fulfillmentClassification: string | null;
  fulfillmentClassificationLabel: string;
  inconsistencies: SalesOrderFlowListInconsistency[];
  isInconsistent: boolean;
};

const FULFILLMENT_CLASSIFICATION_LABELS: Record<string, string> = {
  OPEN: "Em aberto",
  PENDING: "Pendente",
  PARTIAL: "Parcial",
  FULFILLED: "Atendido",
  FULFILLED_WITH_CUT: "Atendido com corte",
  NOT_FULFILLED: "Não atendido",
  CANCELED: "Cancelado",
  UNKNOWN: "Desconhecido",
};

export function classifySalesOrderFlowDetailError(error: unknown): {
  kind: "not_found" | "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return {
        kind: "not_found",
        message: "Pedido não encontrado no Fluxo de Pedidos.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para ver o detalhe deste pedido.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API do detalhe do Fluxo de Pedidos indisponível. Tente novamente.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar o detalhe do pedido.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API do detalhe do Fluxo de Pedidos indisponível. Tente novamente.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar o detalhe do pedido.",
  };
}

export function formatSalesOrderFlowDetailDate(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function formatSalesOrderFlowDetailMoney(
  value: number | null | undefined,
  visible: boolean
): string {
  if (!visible) return "Oculto";
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value, 2);
}

export function formatSalesOrderFlowDetailQuantity(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatSalesOrderFlowDetailPercent(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const clamped = Math.max(0, Math.min(100, value));
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(clamped)}%`;
}

export function formatSalesOrderFlowDetailDays(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value === 1 ? "1 dia" : `${value} dias`;
}

export function formatSalesOrderFlowStageLabel(
  stage: string | null | undefined
): string {
  if (!stage) return "—";
  if (isSalesOrderFlowStage(stage)) {
    return SALES_ORDER_FLOW_STAGE_LABELS[stage as SalesOrderFlowStage];
  }
  return stage;
}

export function formatSalesOrderFlowFulfillmentClassification(
  code: string | null | undefined
): string {
  if (!code?.trim()) return "—";
  const key = code.trim().toUpperCase();
  return FULFILLMENT_CLASSIFICATION_LABELS[key] ?? code;
}

export function formatSalesOrderFlowInconsistencyLabel(code: string): string {
  return (
    SALES_ORDER_FLOW_INCONSISTENCY_LABELS[
      code as SalesOrderFlowInconsistencyCode
    ] ?? code
  );
}

export function formatSalesOrderFlowPriorityLabel(
  priority: string | null | undefined
): string {
  const key = String(priority ?? "NORMAL").trim().toUpperCase();
  if (key === "URGENT") return "Urgente";
  if (key === "HIGH") return "Alta";
  if (key === "LOW") return "Baixa";
  return "Normal";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asInconsistencies(value: unknown): SalesOrderFlowListInconsistency[] {
  if (!Array.isArray(value)) return [];
  const out: SalesOrderFlowListInconsistency[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const code = asString((row as { code?: unknown }).code);
    if (!code) continue;
    out.push({
      code,
      severity: asString((row as { severity?: unknown }).severity) ?? "WARNING",
      detail: asString((row as { detail?: unknown }).detail),
    });
  }
  return out;
}

export function resolveSalesOrderFlowDetailItems(
  payload: SalesOrderFlowDetailPayload
): SalesOrderFlowDetailItemView[] {
  return payload.itemSnapshots.map((raw, index) => {
    const productCode = asString(raw.productCode);
    const productName = asString(raw.productName);
    const salesOrderItemId =
      asString(raw.salesOrderItemId) ?? `item-${index + 1}`;
    const inconsistencies = payload.inconsistenciesVisible
      ? asInconsistencies(raw.inconsistencies)
      : [];
    const currentStage = asString(raw.currentStage);
    const classification = asString(raw.fulfillmentClassification);
    const productLabel =
      [productCode, productName].filter(Boolean).join(" · ") ||
      `Item ${index + 1}`;

    return {
      salesOrderItemId,
      productLabel,
      orderedQuantity:
        asNumber(raw.orderedQuantityDisplay) ?? asNumber(raw.orderedQuantity),
      progressProductionOrder: asNumber(raw.progressProductionOrder),
      progressProduced: asNumber(raw.progressProduced),
      progressDocumented: asNumber(raw.progressDocumented),
      progressInvoiced: asNumber(raw.progressInvoiced),
      progressShipped: asNumber(raw.progressShipped),
      activeRemainingQuantity: asNumber(raw.activeRemainingQuantity),
      cutQuantity: asNumber(raw.cutQuantity),
      currentStage,
      stageLabel: formatSalesOrderFlowStageLabel(currentStage),
      nextAction: asString(raw.nextAction),
      fulfillmentClassification: classification,
      fulfillmentClassificationLabel:
        formatSalesOrderFlowFulfillmentClassification(classification),
      inconsistencies,
      isInconsistent: inconsistencies.length > 0,
    };
  });
}

export function resolveSalesOrderFlowDetailDaysInStage(
  payload: SalesOrderFlowDetailPayload
): number | null {
  const fromSnapshot = asNumber(payload.orderSnapshot?.daysInStage);
  if (fromSnapshot != null) return fromSnapshot;
  return null;
}
