/**
 * Prazo médio de recebimento — carga Prisma LEVE sobre a MESMA população da
 * listagem Comercial (GET /api/sales-orders).
 *
 * - População: `parseSalesOrderListQuery` + `resolveSalesOrderListSellerWhere` +
 *   `resolveSalesOrderListWhere` (status, cliente, vendedor, período, ano/mês,
 *   busca, Com/Sem NF, status CR, faixa de valor, presença operacional,
 *   cancelados). Nenhum segundo WHERE é construído aqui; page/pageSize NÃO
 *   limitam a carga (população completa).
 * - Cadeia canônica do CR: SalesOrder → SalesOrderNfeLink (NF válida) →
 *   NomusNfe.xmlDhEmi (emissão da NF-e) / NomusAccountsReceivable.sourceInvoiceId
 *   (títulos, vencimento e valor) — a mesma do filtro "Status CR" e do
 *   cronograma de pagamento da exportação.
 * - Número constante de queries (pedidos de cada população + NF-e + títulos),
 *   sem leitura por pedido, sem `nomusRawResponse`/`rawPayload`, sem escrita.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  buildSalesOrderGrantedPaymentTermMonthlySeries,
  computeSalesOrderGrantedPaymentTermSummary,
  type GrantedPaymentTermDatedOrderInput,
  type SalesOrderGrantedPaymentTermMonthlySeries,
  type SalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTerm.js";
import {
  collectReceivablesForOrderNfes,
  loadSalesOrderListReceivablesByNfeExternalIds,
} from "./salesOrderListPaymentSchedule.server.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { andSalesOrderListWhere } from "./salesOrderListReceivableFilter.js";
import { buildSalesOrderProductFilterWhere } from "./salesOrderProductFilter.js";
import { buildSalesOrderValidNfeLinkWhere } from "./salesOrdersListSummary.js";

/** Select leve da população (sem nomusRawResponse); só NF-e válidas (processadas, não canceladas). */
export function buildSalesOrderGrantedPaymentTermOrderSelect() {
  return {
    id: true,
    issueDate: true,
    totalNetValue: true,
    paymentTerms: true,
    nfeLinks: {
      where: buildSalesOrderValidNfeLinkWhere(),
      select: { nfeExternalId: true, dataProcessamento: true },
    },
  } satisfies Prisma.SalesOrderSelect;
}

/** Emissão da NF-e: xmlDhEmi (canônico); fallback dataProcessamento. */
export const SALES_ORDER_GRANTED_PAYMENT_TERM_NFE_SELECT = {
  externalId: true,
  xmlDhEmi: true,
  dataProcessamento: true,
} as const;

/**
 * Carrega as populações (uma por where) com os títulos do CR já vinculados.
 * Queries: 1 findMany por população (o chamador passa 1 ou 2) + 1 NF-e + 1
 * títulos para a união das NF-e — nunca por pedido.
 */
export async function loadGrantedPaymentTermOrderPopulations(
  db: PrismaClient,
  wheres: readonly Prisma.SalesOrderWhereInput[]
): Promise<GrantedPaymentTermDatedOrderInput[][]> {
  const select = buildSalesOrderGrantedPaymentTermOrderSelect();
  const populations = await Promise.all(
    wheres.map((where) => db.salesOrder.findMany({ where, select }))
  );

  const nfeExternalIds = [
    ...new Set(
      populations.flatMap((orders) =>
        orders.flatMap((order) => order.nfeLinks.map((link) => link.nfeExternalId))
      )
    ),
  ];

  // Em paralelo: emissão das NF-e + títulos do CR dessas NF-e.
  const [nfes, receivablesByNfeId] = await Promise.all([
    nfeExternalIds.length > 0
      ? db.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: SALES_ORDER_GRANTED_PAYMENT_TERM_NFE_SELECT,
        })
      : Promise.resolve([]),
    loadSalesOrderListReceivablesByNfeExternalIds(db, nfeExternalIds),
  ]);

  const issueDateByNfeId = new Map<number, Date | null>(
    nfes.map((nfe) => [nfe.externalId, nfe.xmlDhEmi ?? nfe.dataProcessamento ?? null] as const)
  );

  return populations.map((orders) =>
    orders.map((order): GrantedPaymentTermDatedOrderInput => {
      const orderNfeIds = order.nfeLinks.map((link) => link.nfeExternalId);
      const processingByNfeId = new Map<number, Date | null>(
        order.nfeLinks.map((link) => [link.nfeExternalId, link.dataProcessamento ?? null] as const)
      );
      const titles = collectReceivablesForOrderNfes(orderNfeIds, receivablesByNfeId).map(
        (title) => ({
          dueDate: title.dueDate,
          invoiceIssueDate:
            title.sourceInvoiceId == null
              ? null
              : issueDateByNfeId.get(title.sourceInvoiceId) ??
                processingByNfeId.get(title.sourceInvoiceId) ??
                null,
          amount: title.amountReceivable,
        })
      );
      return {
        id: order.id,
        issueDate: order.issueDate ?? null,
        totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
        paymentTerms: order.paymentTerms,
        // Faturado = tem ao menos uma NF-e válida (mesma regra do filtro "Com NF").
        invoiced: order.nfeLinks.length > 0,
        titles,
      };
    })
  );
}

/** Card da listagem: população filtrada completa (mesmo where do GET /api/sales-orders). */
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
  const [orders] = await loadGrantedPaymentTermOrderPopulations(db, [where]);
  return computeSalesOrderGrantedPaymentTermSummary(orders ?? []);
}

/**
 * Tela Resultado: série mensal do ano filtrado × mesmo período do ano anterior.
 * Usa o where canônico da listagem para cada ano (todos os filtros da tela,
 * exceto Mês — visão de 12 meses) + o filtro opcional de produto da tela
 * Resultado (pedidos que contêm o produto, mesma regra do motor do Resultado).
 */
export async function loadSalesOrderGrantedPaymentTermMonthlySeries(
  db: PrismaClient,
  query: Record<string, unknown>,
  now: Date = new Date()
): Promise<SalesOrderGrantedPaymentTermMonthlySeries> {
  const listQuery = parseSalesOrderListQuery(query);
  const year = listQuery.year ?? now.getFullYear();
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const [currentWhere, previousWhere] = await Promise.all([
    resolveSalesOrderListWhere(db, { ...listQuery, year, month: null }, sellerWhere),
    resolveSalesOrderListWhere(db, { ...listQuery, year: year - 1, month: null }, sellerWhere),
  ]);
  const productWhere = buildSalesOrderProductFilterWhere(query.productId);
  const [currentYearOrders, previousYearOrders] = await loadGrantedPaymentTermOrderPopulations(db, [
    andSalesOrderListWhere(currentWhere, productWhere),
    andSalesOrderListWhere(previousWhere, productWhere),
  ]);
  return buildSalesOrderGrantedPaymentTermMonthlySeries({
    year,
    currentYearOrders: currentYearOrders ?? [],
    previousYearOrders: previousYearOrders ?? [],
  });
}
