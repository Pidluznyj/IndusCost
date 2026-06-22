import type { RawMaterialEstimationConfidence } from "./salesOrderRawMaterialEstimation.js";
import type {
  RawMaterialIntelligenceBlock,
  RawMaterialIntelligenceMaterialRow,
  RawMaterialIntelligenceOrderRow,
  RawMaterialIntelligenceReviewItem,
  RawMaterialIntelligenceUnservedBalanceRow,
} from "./salesOrderRawMaterialIntelligenceTypes.js";
import { RAW_MATERIAL_DEMAND_STATUS_LABELS, type RawMaterialDemandStatus } from "./salesOrderRawMaterialEstimation.js";

export const MATERIAL_DEMAND_INTELLIGENCE_SUBTITLE =
  "Estimativa baseada em pedidos, faturamento, saldo em aberto e janela padrão de 14 dias. Não usa status real de produção.";

export const MATERIAL_DEMAND_INTELLIGENCE_INTERPRETATION = [
  {
    title: "Recomendado",
    text: "Melhor estimativa para orientar a compra de matéria-prima com base no saldo vivo.",
  },
  {
    title: "Conservador",
    text: "Cenário de teto de risco, incluindo saldos com incerteza ou atraso.",
  },
  {
    title: "Revisão",
    text: "Itens que não devem entrar automaticamente na compra — exigem conferência.",
  },
  {
    title: "Potencial não realizado",
    text: "Saldo vendido antigo ainda não faturado; não é demanda automática de matéria-prima.",
  },
] as const;

export type MaterialDemandIntelligenceUiFilters = {
  calculationMode: "recommended" | "conservative";
  estimationStatus: RawMaterialDemandStatus | "ALL";
  criticalOnly: boolean;
  reviewOnly: boolean;
};

export const DEFAULT_MATERIAL_DEMAND_INTELLIGENCE_UI_FILTERS: MaterialDemandIntelligenceUiFilters = {
  calculationMode: "recommended",
  estimationStatus: "ALL",
  criticalOnly: false,
  reviewOnly: false,
};

export function safeDisplayNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

export function formatConfidenceLabel(confidence: RawMaterialEstimationConfidence): string {
  if (confidence === "HIGH") return "Alta";
  if (confidence === "MEDIUM") return "Média";
  return "Baixa";
}

export function agingBandLabel(daysAfterLiveWindow: number): string {
  const days = safeDisplayNumber(daysAfterLiveWindow);
  if (days <= 14) return "0 a 14 dias — dentro do ciclo";
  if (days <= 30) return "15 a 30 dias — atenção";
  if (days <= 60) return "31 a 60 dias — crítico";
  if (days <= 90) return "61 a 90 dias — muito crítico";
  return "90+ dias — provável perda/revisar";
}

export function estimationStatusBadgeClass(status: RawMaterialDemandStatus): string {
  switch (status) {
    case "OPEN_WITHIN_CYCLE":
    case "PARTIALLY_INVOICED_LIVE_BALANCE":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "FULLY_INVOICED":
    case "CANCELLED_OR_CLOSED":
      return "bg-muted text-muted-foreground";
    case "OPEN_OVERDUE_WITHOUT_INVOICE":
    case "PARTIALLY_INVOICED_STALE_BALANCE":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
    case "CRITICAL_UNSERVED_BALANCE_30D":
      return "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200";
    case "MISSING_BOM":
    case "REVIEW_DATA":
      return "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function friendlyEstimationStatusLabel(status: RawMaterialDemandStatus): string {
  return RAW_MATERIAL_DEMAND_STATUS_LABELS[status] ?? status;
}

export function appendIntelligenceQueryParams(
  base: URLSearchParams,
  filters: MaterialDemandIntelligenceUiFilters
): URLSearchParams {
  const qs = new URLSearchParams(base.toString());
  qs.set("calculationMode", filters.calculationMode);
  if (filters.criticalOnly) {
    qs.set("estimationStatus", "CRITICAL_UNSERVED_BALANCE_30D");
  } else if (filters.reviewOnly) {
    qs.delete("estimationStatus");
  } else if (filters.estimationStatus !== "ALL") {
    qs.set("estimationStatus", filters.estimationStatus);
  } else {
    qs.delete("estimationStatus");
  }
  return qs;
}

export function filterIntelligenceView(
  intelligence: RawMaterialIntelligenceBlock,
  filters: MaterialDemandIntelligenceUiFilters
): {
  materials: RawMaterialIntelligenceMaterialRow[];
  orders: RawMaterialIntelligenceOrderRow[];
  unservedBalances: RawMaterialIntelligenceUnservedBalanceRow[];
  reviewItems: RawMaterialIntelligenceReviewItem[];
} {
  let orders = intelligence.orders;
  let unservedBalances = intelligence.unservedBalances;
  let reviewItems = intelligence.reviewItems;

  if (filters.criticalOnly) {
    orders = orders.filter((row) => row.estimationStatus === "CRITICAL_UNSERVED_BALANCE_30D");
    unservedBalances = unservedBalances.filter((row) => row.daysAfterLiveWindow > 30);
    reviewItems = reviewItems.filter((row) =>
      row.reason.toLowerCase().includes("crítico") || row.reason.toLowerCase().includes("atrasad")
    );
  }

  if (filters.reviewOnly) {
    orders = orders.filter((row) => row.reviewRequired);
    reviewItems = [...reviewItems];
  }

  if (filters.estimationStatus !== "ALL" && !filters.criticalOnly) {
    orders = orders.filter((row) => row.estimationStatus === filters.estimationStatus);
    unservedBalances = unservedBalances.filter(
      (row) => orders.some((o) => o.orderId === row.orderId && o.productCode === row.productCode)
    );
  }

  const materialCodes = new Set(
    orders.flatMap((o) => [o.productCode]).filter(Boolean)
  );
  const materials =
    filters.criticalOnly || filters.reviewOnly || filters.estimationStatus !== "ALL"
      ? intelligence.materials.filter(
          (m) => m.reviewQuantity > 0 || m.recommendedQuantity > 0 || m.conservativeQuantity > 0
        )
      : intelligence.materials;

  void materialCodes;

  return { materials, orders, unservedBalances, reviewItems };
}

export function emptyIntelligenceBlock(): RawMaterialIntelligenceBlock {
  return {
    summary: {
      recommendedDemandQuantity: 0,
      conservativeDemandQuantity: 0,
      uncertaintyDemandQuantity: 0,
      recommendedDemandValue: 0,
      conservativeDemandValue: 0,
      uncertaintyDemandValue: 0,
      reviewItemsCount: 0,
      missingBomCount: 0,
      criticalUnservedBalanceAmount: 0,
      unservedRevenuePotential: 0,
      confidence: "HIGH",
      consideredOrdersCount: 0,
      consideredItemsCount: 0,
      excludedFullyInvoicedCount: 0,
      stalePartialBalanceCount: 0,
    },
    materials: [],
    orders: [],
    unservedBalances: [],
    reviewItems: [],
    audit: {
      source: "",
      rulesVersion: "",
      billingCycleDays: 14,
      partialBillingLiveDays: 14,
      staleBalanceDays: 30,
      filtersApplied: {},
      lastSyncInfo: null,
      warnings: [],
    },
  };
}
