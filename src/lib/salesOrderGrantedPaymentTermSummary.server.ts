/**
 * Prazo médio concedido — agregação Prisma LEVE sobre a MESMA população da
 * listagem Comercial (GET /api/sales-orders).
 *
 * - População: `parseSalesOrderListQuery` + `resolveSalesOrderListSellerWhere` +
 *   `resolveSalesOrderListWhere` (status, cliente, vendedor, período, ano/mês,
 *   busca, Com/Sem NF, status CR, faixa de valor, presença operacional,
 *   cancelados). Nenhum segundo WHERE é construído aqui.
 * - Peso: só `totalNetValue > 0`, combinado por AND com o where canônico.
 * - Paginação (page/pageSize) NÃO limita a agregação: população completa.
 * - Número constante de queries agregadas (groupBy + aggregate), sem findMany,
 *   sem `nomusRawResponse`, sem N+1, sem escrita e sem acesso a CR.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  computeGrantedPaymentTermSummary,
  type GrantedPaymentTermGroupInput,
  type SalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTerm.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { andSalesOrderListWhere } from "./salesOrderListReceivableFilter.js";

/** Peso da média: somente valor líquido POSITIVO (nunca abs(), zero fora do denominador). */
export function buildSalesOrderGrantedPaymentTermWeightWhere(): Prisma.SalesOrderWhereInput {
  return { totalNetValue: { gt: 0 } };
}

export async function loadSalesOrderGrantedPaymentTermSummary(
  db: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderGrantedPaymentTermSummary> {
  const listQuery = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  // Mesmo where das linhas/count/cards/exportações da listagem.
  const where = await resolveSalesOrderListWhere(db, listQuery, sellerWhere);
  const weightWhere = andSalesOrderListWhere(where, buildSalesOrderGrantedPaymentTermWeightWhere());

  const [groups, population] = await Promise.all([
    // 1 query: Σ valor líquido positivo + contagem por condição de pagamento.
    db.salesOrder.groupBy({
      by: ["paymentTerms"],
      where: weightWhere,
      _count: { _all: true },
      _sum: { totalNetValue: true },
    }),
    // 1 query: contagem da população filtrada completa (auditoria zero/negativo).
    db.salesOrder.aggregate({
      where,
      _count: { _all: true },
    }),
  ]);

  const inputs: GrantedPaymentTermGroupInput[] = groups.map((group) => ({
    paymentTerms: group.paymentTerms,
    orderCount: group._count._all,
    salesAmount: decimalToNumber(group._sum.totalNetValue) ?? 0,
  }));

  return computeGrantedPaymentTermSummary(inputs, {
    totalOrders: population._count._all,
  });
}
