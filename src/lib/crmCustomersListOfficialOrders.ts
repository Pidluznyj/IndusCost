/**
 * Carteira CRM — fonte oficial SalesOrder + eixo Responsável Comercial.
 * Vendedor Nomus do pedido: só auditoria. Sem propostas. Sem comissão.
 */

export const CRM_CUSTOMERS_LIST_SOURCE_INFO = {
  eixo: "RESPONSAVEL_COMERCIAL_CLIENTE" as const,
  pedidosFonte: "SalesOrder" as const,
  itensFonte: "SalesOrderItem" as const,
  vendedorPedidoFonte: "Nomus/SalesOrder seller field" as const,
  responsavelCarteira: "CrmCustomerCommercialOwner" as const,
  propostasUsadas: false as const,
  comissionamentoAfetado: false as const,
};

export type CrmCustomersListSourceInfo = typeof CRM_CUSTOMERS_LIST_SOURCE_INFO & {
  period?: { dateFrom: string | null; dateTo: string | null };
};

export function buildCrmCustomersListSourceInfo(period?: {
  dateFrom: string | null;
  dateTo: string | null;
}): CrmCustomersListSourceInfo {
  return {
    ...CRM_CUSTOMERS_LIST_SOURCE_INFO,
    period,
  };
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Default período de valor: últimos 30 dias (inclui hoje). */
export function resolveCrmCustomersListPeriod(
  input: { dateFrom?: string | null; dateTo?: string | null },
  now = new Date()
): { dateFrom: string; dateTo: string } {
  const to =
    input.dateTo?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo.trim())
      ? input.dateTo.trim()
      : formatYmd(now);
  if (input.dateFrom?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom.trim())) {
    return { dateFrom: input.dateFrom.trim(), dateTo: to };
  }
  const start = new Date(`${to}T12:00:00`);
  start.setDate(start.getDate() - 29);
  return { dateFrom: formatYmd(start), dateTo: to };
}

export type CrmPortfolioStatus =
  | "SEM_COMPRA"
  | "CARTEIRA_ABERTA"
  | "SOMENTE_FATURADO"
  | "COM_HISTORICO";

export function resolveCrmPortfolioStatus(args: {
  hasPurchaseHistory: boolean;
  hasOpenPortfolio: boolean;
}): CrmPortfolioStatus {
  if (!args.hasPurchaseHistory) return "SEM_COMPRA";
  if (args.hasOpenPortfolio) return "CARTEIRA_ABERTA";
  return "SOMENTE_FATURADO";
}
