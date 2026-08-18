/**
 * Ponte Gestão Geral ↔ crmSalesOrderMetricsService (motor oficial Pedidos).
 */

import type { ManagementDashboardSourceInfo } from "@/src/components/crmManagementTypes";
import type { CrmSalesOrderMetricsResult } from "@/src/lib/commercial/crmSalesOrderMetricsService.js";
import type { ManagementDashboardSummary } from "@/src/components/crmManagementTypes";

export type CrmManagementDashboardRequest = {
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Ano do recorte — mesmo vocabulário da tela Pedidos de Venda. */
  year?: number | null;
  /** Mês 1..12 dentro do ano; ausente = ano inteiro. */
  month?: number | null;
  /** "Todos os anos" — espelha o `allYears` da tela Pedidos de Venda. */
  allYears?: boolean | null;
};

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Primeiro ano com pedido no sistema — âncora de "todos os anos". Não usamos
 * 1970: janela absurda só faz o banco varrer índice à toa.
 */
const CRM_ALL_YEARS_START = "2019-01-01";

/**
 * Recorte do cockpit — MESMA régua da tela Pedidos de Venda:
 * ano vigente por padrão, mês opcional dentro do ano, "todos" para série
 * inteira. `dateFrom`/`dateTo` continuam aceitos (uso programático e links
 * antigos) e têm prioridade quando vêm explícitos.
 *
 * O default era "últimos 30 dias", enquanto Pedidos de Venda abre no ano
 * vigente: as duas telas nunca falavam do mesmo período, e nenhum número
 * batia por construção.
 */
export function resolveManagementDashboardPeriod(
  input: CrmManagementDashboardRequest,
  now = new Date()
): { dateFrom: string; dateTo: string } {
  const explicitFrom =
    input.dateFrom?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom.trim())
      ? input.dateFrom.trim()
      : null;
  const explicitTo =
    input.dateTo?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo.trim())
      ? input.dateTo.trim()
      : null;
  if (explicitFrom || explicitTo) {
    return {
      dateFrom: explicitFrom ?? CRM_ALL_YEARS_START,
      dateTo: explicitTo ?? formatYmd(now),
    };
  }

  if (input.allYears) {
    return { dateFrom: CRM_ALL_YEARS_START, dateTo: formatYmd(now) };
  }

  const year =
    input.year != null && Number.isFinite(input.year) && input.year > 1900
      ? Math.trunc(input.year)
      : now.getFullYear();
  const month =
    input.month != null && Number.isFinite(input.month) && input.month >= 1 && input.month <= 12
      ? Math.trunc(input.month)
      : null;

  if (month) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return {
      dateFrom: `${year}-${mm}-01`,
      dateTo: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

/** Janelas móveis: contadores de relacionamento não seguem o período do filtro. */
export const CRM_ROLLING_WINDOW_NOTE =
  "Contato, follow-up e atividades usam janelas móveis (7/30/60/90 dias a partir de hoje) — não seguem o período selecionado." as const;

export function buildManagementDashboardSourceInfo(args: {
  dateFrom: string | null;
  dateTo: string | null;
  metrics: Pick<CrmSalesOrderMetricsResult, "debug">;
}): ManagementDashboardSourceInfo {
  return {
    pedidosFonte: "SalesOrder",
    itensFonte: "SalesOrderItem",
    eixoCarteira: "Responsável Comercial do Cliente",
    vendedorComissionavel: "Vendedor do Pedido/Nomus, somente auditoria",
    propostasUsadas: false,
    metricsSource: args.metrics.debug.metricsSource,
    rulesEngineVersion: args.metrics.debug.rulesEngineVersion,
    period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
    truncated: args.metrics.debug.truncated ?? false,
    matchedOrderCount: args.metrics.debug.matchedOrderCount,
    rollingWindowNote: CRM_ROLLING_WINDOW_NOTE,
  };
}

export function mergeOfficialOrderMetricsIntoManagementSummary(args: {
  base: ManagementDashboardSummary;
  metrics: CrmSalesOrderMetricsResult;
  totalCustomers: number;
  /**
   * Clientes no escopo SEM pedido válido no período, contado no banco com a
   * mesma régua dos cards. Antes era `totalCustomers − customersWithOrders`:
   * subtraía uma contagem do PERÍODO de uma base SEM período, e o número
   * saía inflado por construção.
   */
  customersWithoutOrderInPeriod?: number;
}): ManagementDashboardSummary {
  const withoutOrder =
    args.customersWithoutOrderInPeriod != null
      ? Math.max(0, args.customersWithoutOrderInPeriod)
      : Math.max(0, args.totalCustomers - args.metrics.customersWithOrders);
  return {
    ...args.base,
    openOrdersCount: args.metrics.openPortfolioOrders,
    openOrdersValue: args.metrics.openPortfolioValue,
    ordersIssued: args.metrics.totalOrders,
    ordersValue: args.metrics.totalOrderValue,
    invoicedOrdersCount: args.metrics.invoicedOrders,
    invoicedOrdersValue: args.metrics.invoicedValue,
    canceledOrdersCount: args.metrics.canceledOrders,
    averageTicket: args.metrics.averageTicket,
    customersWithOrders: args.metrics.customersWithOrders,
    customersWithoutOrderInPeriod: withoutOrder,
    ordersWithoutNomusSeller: args.metrics.ordersWithoutNomusSeller,
    customersWithoutCommercialResponsible: args.metrics.customersWithoutCommercialResponsible,
    ordersWithResponsibleDifferentFromOrderSeller:
      args.metrics.ordersWithResponsibleDifferentFromOrderSeller,
  };
}
