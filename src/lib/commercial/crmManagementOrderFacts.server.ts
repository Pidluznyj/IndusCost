/**
 * Fatos de PEDIDO para o cockpit do CRM — todos derivados da população
 * canônica da tela Pedidos de Venda.
 *
 * Este módulo existe para que o CRM pare de reescrever regra em SQL. Cada
 * consulta aqui é um `groupBy`/`findMany` do Prisma sobre o where produzido
 * por `crmCanonicalSalesOrderWhere`, que por sua vez é o construtor oficial
 * (`buildSalesOrderListWhere`). Nenhuma decisão de negócio nasce neste
 * arquivo: ele só agrega o que o canônico já selecionou.
 *
 * Divisão explícita de responsabilidade:
 *   - PEDIDO (aqui)      → canônico, tem que reconciliar com Pedidos de Venda;
 *   - RELACIONAMENTO     → CommercialActivity, é métrica própria do CRM.
 */

import type { PrismaClient } from "@prisma/client";
import { buildEconomicGroupCustomerMatchOr } from "@/src/lib/financeInternalGroupExclusions.js";
import {
  crmCanonicalSalesOrderWhere,
  type CrmCanonicalPeriod,
} from "@/src/lib/commercial/crmCanonicalSalesOrderScope.server.js";

/**
 * Horizonte de relacionamento do cockpit. Recência e "sem compra" olham para
 * trás por uma janela explícita em vez de varrer a base inteira — o número
 * fica estável, a consulta fica limitada e o rótulo pode dizer a verdade.
 */
export const CRM_RELATIONSHIP_HORIZON_MONTHS = 24;

export type CrmCustomerScopeRow = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
};

export type CrmOrderAggregate = { orders: number; value: number };

export type CrmManagementOrderFacts = {
  /** Clientes elegíveis ao cockpit: ativos e fora do grupo econômico. */
  customers: CrmCustomerScopeRow[];
  customerById: Map<string, CrmCustomerScopeRow>;
  /** Carteira aberta (canônico `hasInvoice: false`) por cliente. */
  openPortfolioByCustomer: Map<string, CrmOrderAggregate>;
  /** Pedidos em carteira aberta — id + dados para a lista de follow-up. */
  openPortfolioOrders: Array<{
    id: string;
    orderCode: string;
    customerId: string | null;
    status: string;
    totalNetValue: number;
    updatedAt: Date;
    responsible: string | null;
  }>;
  /** Última emissão válida por cliente dentro do horizonte. */
  lastPurchaseByCustomer: Map<string, Date>;
  /** Compras dos últimos 12 meses por cliente. */
  purchase12mByCustomer: Map<string, CrmOrderAggregate>;
  /** Clientes com pedido válido no PERÍODO selecionado. */
  customersWithOrderInPeriod: Set<string>;
  /** Clientes com pedido válido dentro do horizonte de relacionamento. */
  customersWithPurchaseInHorizon: Set<string>;
};

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in (value as object)) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function crmRelationshipHorizonStart(now: Date): Date {
  const start = new Date(now);
  start.setMonth(start.getMonth() - CRM_RELATIONSHIP_HORIZON_MONTHS);
  return start;
}

export async function loadCrmManagementOrderFacts(
  prisma: PrismaClient,
  period: CrmCanonicalPeriod,
  now: Date
): Promise<CrmManagementOrderFacts> {
  // O `groupBy` do Prisma tem inferência recursiva pesada; a chamada é
  // encapsulada num handle tipado para não estourar o compilador — os
  // shapes de retorno continuam explícitos abaixo.
  const groupSalesOrders = prisma.salesOrder.groupBy as unknown as (
    args: Record<string, unknown>
  ) => Promise<Array<Record<string, any>>>;

  const horizonStart = crmRelationshipHorizonStart(now);
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  // Escopo de cliente: ativo e fora do grupo, usando a MESMA lista de
  // predicados do canônico (extraída, não reescrita).
  const customerScopeWhere = {
    status: { not: "INACTIVE" },
    NOT: { OR: buildEconomicGroupCustomerMatchOr() },
  } as const;

  const [customers, openAgg, openOrders, lastPurchaseAgg, purchase12mAgg, inPeriodAgg] =
    await Promise.all([
      prisma.customer.findMany({
        where: customerScopeWhere as never,
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
          city: true,
          state: true,
        },
      }),
      groupSalesOrders({
        by: ["customerId"],
        where: crmCanonicalSalesOrderWhere(period, {
          hasInvoice: false,
          ignorePeriod: true,
        }) as never,
        _count: { _all: true },
        _sum: { totalNetValue: true },
      }),
      prisma.salesOrder.findMany({
        where: crmCanonicalSalesOrderWhere(period, {
          hasInvoice: false,
          ignorePeriod: true,
        }) as never,
        select: {
          id: true,
          orderCode: true,
          customerId: true,
          status: true,
          totalNetValue: true,
          updatedAt: true,
          responsible: true,
        },
        orderBy: { updatedAt: "asc" },
        take: 5000,
      }),
      groupSalesOrders({
        by: ["customerId"],
        where: crmCanonicalSalesOrderWhere(period, { issuedFrom: horizonStart }) as never,
        _max: { issueDate: true },
      }),
      groupSalesOrders({
        by: ["customerId"],
        where: crmCanonicalSalesOrderWhere(period, { issuedFrom: twelveMonthsAgo }) as never,
        _count: { _all: true },
        _sum: { totalNetValue: true },
      }),
      groupSalesOrders({
        by: ["customerId"],
        where: crmCanonicalSalesOrderWhere(period) as never,
        _count: { _all: true },
      }),
    ]);

  const customerById = new Map(customers.map((c) => [c.id, c as CrmCustomerScopeRow]));

  const openPortfolioByCustomer = new Map<string, CrmOrderAggregate>();
  for (const row of openAgg) {
    if (!row.customerId) continue;
    openPortfolioByCustomer.set(row.customerId, {
      orders: row._count._all,
      value: toNumber(row._sum.totalNetValue),
    });
  }

  const lastPurchaseByCustomer = new Map<string, Date>();
  for (const row of lastPurchaseAgg) {
    if (!row.customerId || !row._max.issueDate) continue;
    lastPurchaseByCustomer.set(row.customerId, row._max.issueDate);
  }

  const purchase12mByCustomer = new Map<string, CrmOrderAggregate>();
  for (const row of purchase12mAgg) {
    if (!row.customerId) continue;
    purchase12mByCustomer.set(row.customerId, {
      orders: row._count._all,
      value: toNumber(row._sum.totalNetValue),
    });
  }

  const customersWithOrderInPeriod = new Set<string>();
  for (const row of inPeriodAgg) {
    if (row.customerId) customersWithOrderInPeriod.add(row.customerId);
  }

  return {
    customers: customers as CrmCustomerScopeRow[],
    customerById,
    openPortfolioByCustomer,
    openPortfolioOrders: openOrders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      customerId: o.customerId,
      status: o.status,
      totalNetValue: toNumber(o.totalNetValue),
      updatedAt: o.updatedAt,
      responsible: o.responsible,
    })),
    lastPurchaseByCustomer,
    purchase12mByCustomer,
    customersWithOrderInPeriod,
    customersWithPurchaseInHorizon: new Set(lastPurchaseByCustomer.keys()),
  };
}
