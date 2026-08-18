/**
 * Escopo canônico de Pedido de Venda para o CRM.
 *
 * REGRA DE OURO: o CRM não define o que é pedido válido, carteira, faturado,
 * intercompany ou período. Tudo isso é decidido por UMA implementação — a da
 * tela Pedidos de Venda — e este módulo apenas a CONSOME:
 *
 *   população/filtros  → `buildSalesOrderListWhere` (salesOrdersListSummary)
 *                        · status ≠ CANCELLED · presença operacional Nomus
 *                        · faixa de emissão meio-aberta [gte, lt)
 *   intercompany       → `buildEconomicGroupCustomerPrismaExclusion`
 *                        (via opção `excludeEconomicGroupCustomers`)
 *   NF válida          → `buildSalesOrderValidNfeLinkWhere`
 *                        (via filtro `hasInvoice`)
 *   período            → `resolveSalesOrderIssueDateRange`
 *
 * Antes o CRM tinha fragmentos SQL próprios reescrevendo essas regras — e elas
 * divergiam em quatro pontos (ERROR, borda de período, prefixo de nome do
 * grupo, exigência de `presentInLastPayload`). Nada aqui pode voltar a decidir
 * regra: se faltar algo, o lugar de mudar é o módulo canônico.
 */

import type { Prisma } from "@prisma/client";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import { resolveSalesOrderIssueDateRange } from "@/src/lib/salesOrderPeriodFilter.js";

/** Recorte do cockpit no mesmo vocabulário da tela Pedidos de Venda. */
export type CrmCanonicalPeriod = {
  year?: number | null;
  month?: number | null;
  /** true = série inteira (sem recorte de emissão). */
  allYears?: boolean | null;
};

/** Faixa meio-aberta [gte, lt) da emissão — `null` em "todos os anos". */
export function crmCanonicalIssueRange(
  period: CrmCanonicalPeriod
): { gte: Date; lt: Date } | null {
  if (period.allYears) return null;
  return resolveSalesOrderIssueDateRange(period.year ?? null, period.month ?? null);
}

type CrmCanonicalWhereOptions = {
  /** true = só carteira aberta; false = só faturado; undefined = tudo. */
  hasInvoice?: boolean;
  /** Ignora o recorte de período (recência/histórico do cliente). */
  ignorePeriod?: boolean;
  /** Janela própria (ex.: últimos 12 meses) — sobrepõe o período do filtro. */
  issuedFrom?: Date | null;
};

/**
 * Where oficial de pedido para qualquer leitura do CRM. Um único ponto de
 * entrada — quem precisar de carteira/faturado passa `hasInvoice`.
 */
export function crmCanonicalSalesOrderWhere(
  period: CrmCanonicalPeriod,
  options: CrmCanonicalWhereOptions = {}
): Prisma.SalesOrderWhereInput {
  return buildSalesOrderListWhere(
    {
      // A faixa canônica já é meio-aberta; passamos ano/mês para o próprio
      // builder resolvê-la, em vez de recalcular datas aqui.
      year: options.ignorePeriod || options.issuedFrom ? undefined : period.year ?? undefined,
      month: options.ignorePeriod || options.issuedFrom ? undefined : period.month ?? undefined,
      startDate: options.issuedFrom ?? undefined,
      hasInvoice: options.hasInvoice,
    },
    { excludeEconomicGroupCustomers: true }
  );
}
