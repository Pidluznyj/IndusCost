/**
 * Analytics do Fluxo de Pedidos a partir do resumo materializado.
 * CFD/burnup/burndown aqui são snapshots do WIP atual (sem série histórica de API).
 */

import {
  SALES_ORDER_FLOW_STAGE_LABELS,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog";
import type { SalesOrderFlowSummaryColumn } from "@/src/lib/sales/salesOrderFlowSummary";

export const SALES_ORDER_FLOW_ANALYTICS_OPERATIONAL_STAGES: readonly SalesOrderFlowStage[] =
  [
    "WAITING_RELEASE",
    "WAITING_PRODUCTION_ORDER",
    "IN_PRODUCTION",
    "WAITING_OUTPUT_DOCUMENT",
    "WAITING_NFE",
    "SHIPPED_COMPLETED",
  ];

export type SalesOrderFlowWipPoint = {
  stage: SalesOrderFlowStage;
  label: string;
  orderCount: number;
  orderValue: number | null;
  activeResidualValue: number | null;
};

export type SalesOrderFlowCfdPoint = {
  stage: SalesOrderFlowStage;
  label: string;
  /** Pedidos ainda nesta etapa (WIP). */
  wip: number;
  /** Pedidos que já passaram por esta etapa ou estão nela (cumulativo). */
  cumulativeReached: number;
  /** Pedidos ainda à frente no funil (pendentes de conclusão). */
  remainingAhead: number;
};

export type SalesOrderFlowBurnPoint = {
  key: "scope" | "completed" | "remaining";
  label: string;
  value: number;
};

export type SalesOrderFlowRiskPoint = {
  key: "overdue" | "blocked" | "inconsistent" | "partial" | "cut" | "healthy";
  label: string;
  value: number;
};

export type SalesOrderFlowAnalyticsModel = {
  wipByStage: SalesOrderFlowWipPoint[];
  cfd: SalesOrderFlowCfdPoint[];
  burnup: SalesOrderFlowBurnPoint[];
  burndown: SalesOrderFlowBurnPoint[];
  risks: SalesOrderFlowRiskPoint[];
  totals: {
    activeOrders: number;
    completedOrders: number;
    remainingOrders: number;
    scopeOrders: number;
  };
};

function columnCount(
  columns: readonly SalesOrderFlowSummaryColumn[],
  stage: SalesOrderFlowStage
): number {
  return columns.find((column) => column.stage === stage)?.orderCount ?? 0;
}

function columnMoney(
  columns: readonly SalesOrderFlowSummaryColumn[],
  stage: SalesOrderFlowStage,
  field: "orderValue" | "activeResidualValue"
): number | null {
  const column = columns.find((item) => item.stage === stage);
  if (!column) return null;
  return column[field];
}

export function buildSalesOrderFlowWipByStage(
  columns: readonly SalesOrderFlowSummaryColumn[]
): SalesOrderFlowWipPoint[] {
  return SALES_ORDER_FLOW_ANALYTICS_OPERATIONAL_STAGES.map((stage) => ({
    stage,
    label: SALES_ORDER_FLOW_STAGE_LABELS[stage],
    orderCount: columnCount(columns, stage),
    orderValue: columnMoney(columns, stage, "orderValue"),
    activeResidualValue: columnMoney(columns, stage, "activeResidualValue"),
  }));
}

/**
 * CFD snapshot: WIP por etapa + cumulativo de pedidos que já chegaram
 * à etapa (soma desta etapa até o fim do funil operacional).
 */
export function buildSalesOrderFlowCfdSnapshot(
  columns: readonly SalesOrderFlowSummaryColumn[]
): SalesOrderFlowCfdPoint[] {
  const wip = SALES_ORDER_FLOW_ANALYTICS_OPERATIONAL_STAGES.map((stage) =>
    columnCount(columns, stage)
  );
  const total = wip.reduce((sum, n) => sum + n, 0);
  let remainingAhead = total;
  return SALES_ORDER_FLOW_ANALYTICS_OPERATIONAL_STAGES.map((stage, index) => {
    const stageWip = wip[index] ?? 0;
    const cumulativeReached = wip
      .slice(index)
      .reduce((sum, n) => sum + n, 0);
    const point: SalesOrderFlowCfdPoint = {
      stage,
      label: SALES_ORDER_FLOW_STAGE_LABELS[stage],
      wip: stageWip,
      cumulativeReached,
      remainingAhead,
    };
    remainingAhead = Math.max(0, remainingAhead - stageWip);
    return point;
  });
}

export function buildSalesOrderFlowBurnMetrics(
  columns: readonly SalesOrderFlowSummaryColumn[]
): {
  burnup: SalesOrderFlowBurnPoint[];
  burndown: SalesOrderFlowBurnPoint[];
  totals: SalesOrderFlowAnalyticsModel["totals"];
} {
  const completedOrders = columnCount(columns, "SHIPPED_COMPLETED");
  const remainingOrders = SALES_ORDER_FLOW_ANALYTICS_OPERATIONAL_STAGES.filter(
    (stage) => stage !== "SHIPPED_COMPLETED"
  ).reduce((sum, stage) => sum + columnCount(columns, stage), 0);
  const scopeOrders = completedOrders + remainingOrders;

  const burnup: SalesOrderFlowBurnPoint[] = [
    { key: "scope", label: "Escopo (total)", value: scopeOrders },
    { key: "completed", label: "Concluídos", value: completedOrders },
    { key: "remaining", label: "Em aberto", value: remainingOrders },
  ];

  const burndown: SalesOrderFlowBurnPoint[] = [
    { key: "scope", label: "Escopo inicial", value: scopeOrders },
    { key: "remaining", label: "Trabalho restante", value: remainingOrders },
    { key: "completed", label: "Já entregue", value: completedOrders },
  ];

  return {
    burnup,
    burndown,
    totals: {
      activeOrders: remainingOrders,
      completedOrders,
      remainingOrders,
      scopeOrders,
    },
  };
}

export function buildSalesOrderFlowRiskBreakdown(input: {
  activeOrders: number;
  overdueCount: number;
  blockedCount: number;
  inconsistentCount: number | null;
  partiallyShippedCount: number;
  completedWithCutCount: number;
}): SalesOrderFlowRiskPoint[] {
  const flagged = Math.min(
    input.activeOrders,
    input.overdueCount +
      input.blockedCount +
      (input.inconsistentCount ?? 0) +
      input.partiallyShippedCount +
      input.completedWithCutCount
  );
  const healthy = Math.max(0, input.activeOrders - flagged);

  return [
    { key: "overdue", label: "Atrasados", value: input.overdueCount },
    { key: "blocked", label: "Bloqueados", value: input.blockedCount },
    {
      key: "inconsistent",
      label: "Inconsistentes",
      value: input.inconsistentCount ?? 0,
    },
    {
      key: "partial",
      label: "Parcialmente enviados",
      value: input.partiallyShippedCount,
    },
    { key: "cut", label: "Com corte", value: input.completedWithCutCount },
    { key: "healthy", label: "Sem alerta", value: healthy },
  ];
}

export function buildSalesOrderFlowAnalyticsModel(input: {
  columns: readonly SalesOrderFlowSummaryColumn[];
  totals: {
    overdueCount: number;
    blockedCount: number;
    inconsistentCount: number | null;
    partiallyShippedCount: number;
    completedWithCutCount: number;
  };
}): SalesOrderFlowAnalyticsModel {
  const wipByStage = buildSalesOrderFlowWipByStage(input.columns);
  const cfd = buildSalesOrderFlowCfdSnapshot(input.columns);
  const burn = buildSalesOrderFlowBurnMetrics(input.columns);
  const risks = buildSalesOrderFlowRiskBreakdown({
    activeOrders: burn.totals.activeOrders,
    overdueCount: input.totals.overdueCount,
    blockedCount: input.totals.blockedCount,
    inconsistentCount: input.totals.inconsistentCount,
    partiallyShippedCount: input.totals.partiallyShippedCount,
    completedWithCutCount: input.totals.completedWithCutCount,
  });

  return {
    wipByStage,
    cfd,
    burnup: burn.burnup,
    burndown: burn.burndown,
    risks,
    totals: burn.totals,
  };
}
