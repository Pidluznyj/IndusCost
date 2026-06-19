/**
 * Status gerencial dos cards da Gestão de Pedidos — mapeamento 1:1 com a coluna
 * "Status gerencial" do grid (executiveStatusLabel).
 */

export const MANAGEMENT_STATUS_CARD_IDS = [
  "overdueWithoutInvoice",
  "invoicedOnTime",
  "invoicedLate",
  "partialOrCut",
  "delivered",
  "cancelledOrReturned",
  "awaitingInProgress",
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
    label: "Atrasados sem NF",
    hint: "Pedidos com previsão vencida e sem NF processada.",
  },
  {
    id: "invoicedOnTime",
    label: "Faturados no prazo",
    hint: "Pedidos com NF processada até a data prevista.",
  },
  {
    id: "invoicedLate",
    label: "Faturados com atraso",
    hint: "Pedidos com NF processada após a data prevista.",
  },
  {
    id: "partialOrCut",
    label: "Parciais/com corte",
    hint: "Pedidos com atendimento parcial, corte ou divergência de quantidade.",
  },
  {
    id: "delivered",
    label: "Entregues",
    hint: "Pedidos concluídos/entregues conforme status do Nomus.",
  },
  {
    id: "cancelledOrReturned",
    label: "Cancelados/devolvidos",
    hint: "Pedidos cancelados ou devolvidos totalmente/parcialmente.",
  },
  {
    id: "awaitingInProgress",
    label: "Aguardando/em andamento",
    hint: "Pedidos válidos ainda em andamento, sem conclusão gerencial.",
  },
  {
    id: "reviewUnknown",
    label: "Revisar/desconhecidos",
    hint: "Pedidos com dados insuficientes ou status não mapeado.",
  },
];

const EXECUTIVE_LABEL_TO_CARD: Record<string, ManagementStatusCardId> = {
  "Atrasado sem NF": "overdueWithoutInvoice",
  "Faturado total no prazo": "invoicedOnTime",
  "Faturado total com atraso": "invoicedLate",
  "Atendido parcialmente": "partialOrCut",
  "Atendido com corte": "partialOrCut",
  "Faturado parcialmente": "partialOrCut",
  Entregue: "delivered",
  Enviado: "delivered",
  Cancelado: "cancelledOrReturned",
  "Devolvido totalmente": "cancelledOrReturned",
  "Devolvido parcialmente": "cancelledOrReturned",
  "Divergente — revisar": "reviewUnknown",
  "Status desconhecido": "reviewUnknown",
  "Aguardando liberação": "awaitingInProgress",
  Liberado: "awaitingInProgress",
  "Em andamento": "awaitingInProgress",
  "Atendido totalmente": "awaitingInProgress",
  "Faturado total": "awaitingInProgress",
};

export function resolveManagementStatusCardId(executiveStatusLabel: string): ManagementStatusCardId {
  const trimmed = executiveStatusLabel.trim();
  return EXECUTIVE_LABEL_TO_CARD[trimmed] ?? "reviewUnknown";
}

export function getManagementStatusCardLabel(cardId: ManagementStatusCardId): string {
  return MANAGEMENT_STATUS_CARDS.find((c) => c.id === cardId)?.label ?? cardId;
}

export function getManagementStatusFilterLabel(cardId: ManagementStatusCardId): string {
  const card = MANAGEMENT_STATUS_CARDS.find((c) => c.id === cardId);
  if (!card) return cardId;
  if (cardId === "overdueWithoutInvoice") return "Atrasado sem NF";
  if (cardId === "invoicedOnTime") return "Faturado total no prazo";
  if (cardId === "invoicedLate") return "Faturado total com atraso";
  if (cardId === "partialOrCut") return "Parcial ou com corte";
  if (cardId === "delivered") return "Entregue ou enviado";
  if (cardId === "cancelledOrReturned") return "Cancelado ou devolvido";
  if (cardId === "awaitingInProgress") return "Aguardando ou em andamento";
  return "Revisar ou desconhecido";
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
    delivered: 0,
    cancelledOrReturned: 0,
    awaitingInProgress: 0,
    reviewUnknown: 0,
  };
}

export function emptyManagementStatusCardAmounts(): Record<ManagementStatusCardId, number> {
  return { ...emptyManagementStatusCardCounts() };
}

export function buildManagementStatusCardMetrics(
  rows: Array<{ executiveStatusLabel: string; totalNetValue: number | null | undefined }>
): {
  counts: Record<ManagementStatusCardId, number>;
  amounts: Record<ManagementStatusCardId, number>;
} {
  const counts = emptyManagementStatusCardCounts();
  const amounts = emptyManagementStatusCardAmounts();
  for (const row of rows) {
    const cardId = resolveManagementStatusCardId(row.executiveStatusLabel);
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
  rows: Array<{ executiveStatusLabel: string; totalNetValue: number | null | undefined }>
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
  amounts: Record<ManagementStatusCardId, number>
): ManagementDashboardCard[] {
  const totalOrders = sumManagementStatusCardCounts(counts);
  const totalNetValue = sumManagementStatusCardAmounts(amounts);
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
