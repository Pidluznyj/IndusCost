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
