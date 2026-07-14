/**
 * Labels amigáveis para status de linha do ledger / relatórios de comissão.
 * Sem termos técnicos na UI principal.
 */
export const COMMISSION_RECEIPT_LINE_STATUS_LABELS: Record<string, string> = {
  COMMISSIONABLE: "Comissionável",
  CUSTOMER_EXCLUDED: "Cliente excluído",
  GROUP_COMPANY_EXCLUDED: "Empresa do grupo",
  NO_SELLER: "Sem vendedor",
  SELLER_UNRESOLVED: "Vendedor não resolvido",
  NO_SALES_LINK: "Sem vínculo com pedido",
  NO_SCHEDULE: "Sem programação de comissão",
  NO_RULE: "Sem regra de comissão",
  NO_MARGIN: "Sem margem/tabela",
  COMMISSION_SOURCE_MISMATCH: "Divergente do snapshot",
  STALE_SCHEDULE: "Programação desatualizada",
  ZERO_AMOUNT: "Comissão zerada",
  ERROR: "Erro no cálculo",
  PAID: "Pago",
  RELEASED: "Liberado",
  PREVIEW: "Prévia",
  CLOSED: "Fechado",
};

export const COMMISSION_RECEIPT_LINE_REASON_LABELS: Record<string, string> = {
  CLIENTE_EXCLUIDO_POR_REGRA: "Cliente excluído de comissionamento — revise exclusões de cliente.",
  EMPRESA_GRUPO_EXCLUIDA: "Empresa do grupo — fora da base comissionável.",
  COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT:
    "A comissão do snapshot do pedido diverge da classificação exibida.",
};

export function formatCommissionReceiptLineStatus(status: string | null | undefined): string {
  if (!status?.trim()) return "—";
  const key = status.trim().toUpperCase();
  return COMMISSION_RECEIPT_LINE_STATUS_LABELS[key] ?? status;
}

export function formatCommissionReceiptLineReason(
  reason: string | null | undefined
): string | null {
  if (!reason?.trim()) return null;
  const key = reason.trim();
  return COMMISSION_RECEIPT_LINE_REASON_LABELS[key] ?? reason.trim();
}

export function formatCommissionClosingPeriodStatus(status: string | null | undefined): string {
  if (!status?.trim()) return "—";
  const key = status.trim().toUpperCase();
  if (key === "CLOSED") return "Fechado";
  if (key === "PREVIEW" || key === "PREVIEWED") return "Prévia";
  if (key === "DRAFT") return "Rascunho";
  if (key === "REPROCESSED") return "Reprocessado";
  if (key === "CANCELLED" || key === "CANCELED") return "Cancelado";
  return COMMISSION_RECEIPT_LINE_STATUS_LABELS[key] ?? status;
}

export function formatCommissionPeriodLabel(year: number, month: number): string {
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
