/**
 * Status gerencial dos cards da Gestão de Pedidos — taxonomia executiva (6 buckets + total).
 * Classificação canônica via lifecycle; labels na UI são claros para o usuário.
 */

import type {
  SalesOrderBillingStatus,
  SalesOrderCompletionStatus,
  SalesOrderDeadlineStatus,
  SalesOrderOperationalStatus,
} from "./salesOrderLifecycleTypes.js";

export const MANAGEMENT_STATUS_CARD_IDS = [
  "overdueWithoutInvoice",
  "invoicedOnTime",
  "invoicedLate",
  "partialOrCut",
  "cancelledOrReturned",
  "reviewUnknown",
] as const;

export type ManagementStatusCardId = (typeof MANAGEMENT_STATUS_CARD_IDS)[number];

export const MANAGEMENT_STATUS_CARDS: Array<{
  id: ManagementStatusCardId;
  label: string;
  hint: string;
}> = [
  {
    id: "overdueWithoutInvoice",
    label: "Atrasados aguardando NF",
    hint: "Pedidos com prazo de entrega vencido, ainda sem NF vinculada/processada e não finalizados.",
  },
  {
    id: "invoicedOnTime",
    label: "Faturados no prazo",
    hint: "Pedidos com NF emitida/processada até o prazo previsto.",
  },
  {
    id: "invoicedLate",
    label: "Faturados com atraso",
    hint: "Pedidos com NF emitida/processada após o prazo previsto.",
  },
  {
    id: "partialOrCut",
    label: "Finalizados com corte",
    hint: "Pedidos atendidos parcialmente, faturados parcialmente ou encerrados com diferença entre pedido e atendimento.",
  },
  {
    id: "cancelledOrReturned",
    label: "Canceladas / devolvidas",
    hint: "Pedidos cancelados, devolvidos ou marcados como não válidos no Nomus.",
  },
  {
    id: "reviewUnknown",
    label: "Revisar",
    hint: "Pedidos com status misto, desconhecido ou dados insuficientes para classificação automática.",
  },
];

/** Label singular para coluna do grid (badge por linha). */
export function getManagementCardGridLabel(cardId: ManagementStatusCardId): string {
  switch (cardId) {
    case "overdueWithoutInvoice":
      return "Atrasado aguardando NF";
    case "invoicedOnTime":
      return "Faturado no prazo";
    case "invoicedLate":
      return "Faturado com atraso";
    case "partialOrCut":
      return "Finalizado com corte";
    case "cancelledOrReturned":
      return "Cancelado / devolvido";
    case "reviewUnknown":
      return "Revisar";
    default:
      return cardId;
  }
}

export type LifecycleManagementCardInput = {
  operationalStatus: SalesOrderOperationalStatus;
  billingStatus: SalesOrderBillingStatus;
  deadlineStatus: SalesOrderDeadlineStatus;
  completionStatus: SalesOrderCompletionStatus;
  hasInvoice: boolean;
  executiveStatusLabel: string;
};

function isCancelledOrReturned(lifecycle: LifecycleManagementCardInput): boolean {
  return (
    lifecycle.operationalStatus === "cancelled" ||
    lifecycle.operationalStatus === "fully_returned" ||
    lifecycle.operationalStatus === "partially_returned" ||
    lifecycle.completionStatus === "cancelled" ||
    lifecycle.completionStatus === "returned"
  );
}

function isPartialOrCut(lifecycle: LifecycleManagementCardInput): boolean {
  if (lifecycle.completionStatus === "mixed") return false;
  return (
    lifecycle.operationalStatus === "fulfilled_with_cut" ||
    lifecycle.operationalStatus === "partially_fulfilled" ||
    lifecycle.operationalStatus === "partially_invoiced" ||
    lifecycle.billingStatus === "invoiced_with_cut" ||
    lifecycle.billingStatus === "partially_invoiced" ||
    lifecycle.completionStatus === "partial" ||
    lifecycle.completionStatus === "with_cut"
  );
}

function isFullyInvoiced(lifecycle: LifecycleManagementCardInput): boolean {
  return (
    lifecycle.billingStatus === "fully_invoiced" ||
    lifecycle.operationalStatus === "fully_invoiced"
  );
}

function isOverdueAwaitingInvoice(lifecycle: LifecycleManagementCardInput): boolean {
  if (lifecycle.hasInvoice || isFullyInvoiced(lifecycle)) return false;
  if (isCancelledOrReturned(lifecycle)) return false;
  if (
    lifecycle.operationalStatus === "delivered" ||
    lifecycle.operationalStatus === "shipped" ||
    (lifecycle.operationalStatus === "fully_fulfilled" && lifecycle.hasInvoice)
  ) {
    return false;
  }
  return (
    lifecycle.deadlineStatus === "overdue" ||
    lifecycle.executiveStatusLabel === "Atrasado sem NF"
  );
}

/**
 * Classifica o pedido em um dos 6 cards gerenciais usando o motor canônico de lifecycle.
 */
export function resolveManagementCardFromLifecycle(
  lifecycle: LifecycleManagementCardInput
): ManagementStatusCardId {
  if (isCancelledOrReturned(lifecycle)) {
    return "cancelledOrReturned";
  }

  if (
    lifecycle.operationalStatus === "divergent" ||
    lifecycle.operationalStatus === "unknown" ||
    lifecycle.completionStatus === "mixed"
  ) {
    return "reviewUnknown";
  }

  if (isPartialOrCut(lifecycle)) {
    return "partialOrCut";
  }

  if (isFullyInvoiced(lifecycle) || (lifecycle.hasInvoice && lifecycle.executiveStatusLabel.includes("Faturado total"))) {
    if (lifecycle.deadlineStatus === "invoiced_late") return "invoicedLate";
    if (
      lifecycle.deadlineStatus === "invoiced_on_time" ||
      lifecycle.deadlineStatus === "invoiced_early" ||
      lifecycle.deadlineStatus === "on_time" ||
      lifecycle.deadlineStatus === "due_today" ||
      lifecycle.deadlineStatus === "no_due_date"
    ) {
      return "invoicedOnTime";
    }
    if (lifecycle.executiveStatusLabel === "Faturado total com atraso") return "invoicedLate";
    if (lifecycle.executiveStatusLabel === "Faturado total no prazo") return "invoicedOnTime";
  }

  if (
    lifecycle.hasInvoice &&
    (lifecycle.operationalStatus === "delivered" ||
      lifecycle.operationalStatus === "shipped" ||
      lifecycle.operationalStatus === "fully_fulfilled")
  ) {
    return lifecycle.deadlineStatus === "invoiced_late" ? "invoicedLate" : "invoicedOnTime";
  }

  if (isOverdueAwaitingInvoice(lifecycle)) {
    return "overdueWithoutInvoice";
  }

  if (
    lifecycle.operationalStatus === "awaiting_release" ||
    lifecycle.operationalStatus === "released" ||
    lifecycle.operationalStatus === "in_progress"
  ) {
    if (isOverdueAwaitingInvoice(lifecycle)) return "overdueWithoutInvoice";
    return "reviewUnknown";
  }

  if (lifecycle.operationalStatus === "delivered" || lifecycle.operationalStatus === "shipped") {
    if (lifecycle.hasInvoice) {
      return lifecycle.deadlineStatus === "invoiced_late" ? "invoicedLate" : "invoicedOnTime";
    }
    return "partialOrCut";
  }

  if (lifecycle.executiveStatusLabel === "Atrasado sem NF") {
    return "overdueWithoutInvoice";
  }

  return "reviewUnknown";
}

const EXECUTIVE_LABEL_TO_CARD: Record<string, ManagementStatusCardId> = {
  "Atrasado sem NF": "overdueWithoutInvoice",
  "Faturado total no prazo": "invoicedOnTime",
  "Faturado total com atraso": "invoicedLate",
  "Atendido parcialmente": "partialOrCut",
  "Atendido com corte": "partialOrCut",
  "Faturado parcialmente": "partialOrCut",
  Cancelado: "cancelledOrReturned",
  "Devolvido totalmente": "cancelledOrReturned",
  "Devolvido parcialmente": "cancelledOrReturned",
  "Divergente — revisar": "reviewUnknown",
  "Status desconhecido": "reviewUnknown",
  Entregue: "invoicedOnTime",
  Enviado: "invoicedOnTime",
  "Faturado total": "invoicedOnTime",
  "Atendido totalmente": "reviewUnknown",
  "Aguardando liberação": "reviewUnknown",
  Liberado: "reviewUnknown",
  "Em andamento": "reviewUnknown",
};

export function resolveManagementStatusCardId(
  executiveStatusLabel: string,
  lifecycle?: LifecycleManagementCardInput
): ManagementStatusCardId {
  if (lifecycle) {
    return resolveManagementCardFromLifecycle(lifecycle);
  }
  const trimmed = executiveStatusLabel.trim();
  return EXECUTIVE_LABEL_TO_CARD[trimmed] ?? "reviewUnknown";
}

export function getManagementStatusCardLabel(cardId: ManagementStatusCardId): string {
  return MANAGEMENT_STATUS_CARDS.find((c) => c.id === cardId)?.label ?? cardId;
}

export function getManagementStatusCardHint(cardId: ManagementStatusCardId): string {
  return MANAGEMENT_STATUS_CARDS.find((c) => c.id === cardId)?.hint ?? "";
}

export function getManagementStatusFilterLabel(cardId: ManagementStatusCardId): string {
  return getManagementCardGridLabel(cardId);
}

export function isManagementStatusCardId(value: string): value is ManagementStatusCardId {
  return (MANAGEMENT_STATUS_CARD_IDS as readonly string[]).includes(value);
}

export function emptyManagementStatusCardCounts(): Record<ManagementStatusCardId, number> {
  return {
    overdueWithoutInvoice: 0,
    invoicedOnTime: 0,
    invoicedLate: 0,
    partialOrCut: 0,
    cancelledOrReturned: 0,
    reviewUnknown: 0,
  };
}

export function emptyManagementStatusCardAmounts(): Record<ManagementStatusCardId, number> {
  return { ...emptyManagementStatusCardCounts() };
}

export function buildManagementStatusCardMetrics(
  rows: Array<{
    executiveStatusLabel: string;
    totalNetValue: number | null | undefined;
    managementStatusCardId?: ManagementStatusCardId;
  }>
): {
  counts: Record<ManagementStatusCardId, number>;
  amounts: Record<ManagementStatusCardId, number>;
} {
  const counts = emptyManagementStatusCardCounts();
  const amounts = emptyManagementStatusCardAmounts();
  for (const row of rows) {
    const cardId =
      row.managementStatusCardId ??
      resolveManagementStatusCardId(row.executiveStatusLabel);
    counts[cardId] += 1;
    const value = row.totalNetValue;
    if (value != null && Number.isFinite(value)) {
      amounts[cardId] += value;
    }
  }
  return { counts, amounts };
}

export function sumManagementStatusCardCounts(
  counts: Record<ManagementStatusCardId, number>
): number {
  return MANAGEMENT_STATUS_CARD_IDS.reduce((sum, id) => sum + counts[id], 0);
}

export function sumManagementStatusCardAmounts(
  amounts: Record<ManagementStatusCardId, number>
): number {
  return MANAGEMENT_STATUS_CARD_IDS.reduce((sum, id) => {
    const v = amounts[id];
    return sum + (v != null && Number.isFinite(v) ? v : 0);
  }, 0);
}

export type ManagementCardReconciliation = {
  countMatches: boolean;
  valueMatches: boolean;
  countDifference: number;
  valueDifference: number;
};

export function reconcileManagementStatusCards(input: {
  totalOrders: number;
  totalNetValue: number;
  counts: Record<ManagementStatusCardId, number>;
  amounts: Record<ManagementStatusCardId, number>;
}): ManagementCardReconciliation & {
  statusCardsTotalCount: number;
  statusCardsTotalValue: number;
} {
  const statusCardsTotalCount = sumManagementStatusCardCounts(input.counts);
  const statusCardsTotalValue = sumManagementStatusCardAmounts(input.amounts);
  const countDifference = input.totalOrders - statusCardsTotalCount;
  const valueDifference =
    Math.round((input.totalNetValue - statusCardsTotalValue) * 100) / 100;
  return {
    statusCardsTotalCount,
    statusCardsTotalValue,
    countMatches: countDifference === 0,
    valueMatches: Math.abs(valueDifference) < 0.01,
    countDifference,
    valueDifference,
  };
}

export type ManagementDashboardCard = {
  key: string;
  label: string;
  count: number;
  totalNetValue: number;
  tooltip: string;
  managementStatus?: ManagementStatusCardId;
  isTotal?: boolean;
};

const TOTAL_CARD_TOOLTIP =
  "Total de pedidos e valor líquido dentro dos filtros atuais (exceto filtro de card de status).";

export function buildManagementDashboardCards(
  rows: Array<{
    executiveStatusLabel: string;
    totalNetValue: number | null | undefined;
    managementStatusCardId?: ManagementStatusCardId;
  }>
): {
  cards: ManagementDashboardCard[];
  reconciliation: ManagementCardReconciliation & {
    statusCardsTotalCount: number;
    statusCardsTotalValue: number;
  };
  totalOrders: number;
  totalNetValue: number;
  validPortfolioCount: number;
  validPortfolioValue: number;
} {
  const { counts, amounts } = buildManagementStatusCardMetrics(rows);
  const totalOrders = rows.length;
  const totalNetValue = rows.reduce((sum, row) => {
    const v = row.totalNetValue;
    return sum + (v != null && Number.isFinite(v) ? v : 0);
  }, 0);
  const reconciliation = reconcileManagementStatusCards({
    totalOrders,
    totalNetValue,
    counts,
    amounts,
  });

  if (process.env.NODE_ENV !== "production" && !reconciliation.countMatches) {
    console.warn(
      "[salesOrderManagement] Reconciliação de quantidade dos cards:",
      reconciliation
    );
  }
  if (process.env.NODE_ENV !== "production" && !reconciliation.valueMatches) {
    console.warn(
      "[salesOrderManagement] Reconciliação de valor dos cards:",
      reconciliation
    );
  }

  const statusCards: ManagementDashboardCard[] = MANAGEMENT_STATUS_CARDS.map((card) => ({
    key: card.id,
    label: card.label,
    count: counts[card.id],
    totalNetValue: amounts[card.id],
    tooltip: card.hint,
    managementStatus: card.id,
  }));

  const cards: ManagementDashboardCard[] = [
    {
      key: "total",
      label: "Total no filtro",
      count: totalOrders,
      totalNetValue,
      tooltip: TOTAL_CARD_TOOLTIP,
      isTotal: true,
    },
    ...statusCards,
  ];

  return {
    cards,
    reconciliation,
    totalOrders,
    totalNetValue,
    validPortfolioCount: totalOrders - counts.cancelledOrReturned,
    validPortfolioValue: totalNetValue - amounts.cancelledOrReturned,
  };
}

/** Monta cards do dashboard a partir de contagens/valores já agregados. */
export function buildManagementDashboardCardsFromAggregates(
  counts: Record<ManagementStatusCardId, number>,
  amounts: Record<ManagementStatusCardId, number>,
  totals?: { totalOrders?: number; totalNetValue?: number }
): ManagementDashboardCard[] {
  const totalOrders = totals?.totalOrders ?? sumManagementStatusCardCounts(counts);
  const totalNetValue = totals?.totalNetValue ?? sumManagementStatusCardAmounts(amounts);
  const statusCards: ManagementDashboardCard[] = MANAGEMENT_STATUS_CARDS.map((card) => ({
    key: card.id,
    label: card.label,
    count: counts[card.id],
    totalNetValue: amounts[card.id],
    tooltip: card.hint,
    managementStatus: card.id,
  }));
  return [
    {
      key: "total",
      label: "Total no filtro",
      count: totalOrders,
      totalNetValue,
      tooltip: TOTAL_CARD_TOOLTIP,
      isTotal: true,
    },
    ...statusCards,
  ];
}

export function assertManagementCardsReconciliation(
  reconciliation: ManagementCardReconciliation
): void {
  if (!reconciliation.countMatches) {
    throw new Error(
      `Reconciliação de cards: diferença de quantidade ${reconciliation.countDifference}`
    );
  }
  if (!reconciliation.valueMatches) {
    throw new Error(
      `Reconciliação de cards: diferença de valor ${reconciliation.valueDifference}`
    );
  }
}
