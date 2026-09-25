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
 * - Número constante de queries (pedidos + NF-e + títulos), sem leitura por
 *   pedido, sem `nomusRawResponse`/`rawPayload`, sem escrita.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  computeSalesOrderGrantedPaymentTermSummary,
  type GrantedPaymentTermOrderInput,
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
import { buildSalesOrderValidNfeLinkWhere } from "./salesOrdersListSummary.js";

/** Select leve da população (sem nomusRawResponse); só NF-e válidas (processadas, não canceladas). */
export function buildSalesOrderGrantedPaymentTermOrderSelect() {
  return {
    id: true,
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

  // 1 query: população filtrada completa com as NF-e válidas de cada pedido.
  const orders = await db.salesOrder.findMany({
    where,
    select: buildSalesOrderGrantedPaymentTermOrderSelect(),
  });

  const nfeExternalIds = [
    ...new Set(orders.flatMap((order) => order.nfeLinks.map((link) => link.nfeExternalId))),
  ];

  // 2 queries em paralelo: emissão das NF-e + títulos do CR dessas NF-e.
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

  const inputs: GrantedPaymentTermOrderInput[] = orders.map((order) => {
    const orderNfeIds = order.nfeLinks.map((link) => link.nfeExternalId);
    const processingByNfeId = new Map<number, Date | null>(
      order.nfeLinks.map((link) => [link.nfeExternalId, link.dataProcessamento ?? null] as const)
    );
    const titles = collectReceivablesForOrderNfes(orderNfeIds, receivablesByNfeId).map((title) => ({
      dueDate: title.dueDate,
      invoiceIssueDate:
        title.sourceInvoiceId == null
          ? null
          : issueDateByNfeId.get(title.sourceInvoiceId) ??
            processingByNfeId.get(title.sourceInvoiceId) ??
            null,
      amount: title.amountReceivable,
    }));
    return {
      id: order.id,
      totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
      paymentTerms: order.paymentTerms,
      // Faturado = tem ao menos uma NF-e válida (mesma regra do filtro "Com NF").
      invoiced: order.nfeLinks.length > 0,
      titles,
    };
  });

  return computeSalesOrderGrantedPaymentTermSummary(inputs);
}
