/**
 * Diagnóstico OrderToCashAudit — PD 02534 (matching + evidência de item).
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-pd02534-order-to-cash-db.ts
 *
 * Compara facts materializados no banco com o rebuild em memória (dry).
 * Read-only — não grava.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  buildOrderToCashAuditRows,
  type OrderToCashAuditOrderInput,
  type OrderToCashAuditOrderItemInput,
  type OrderToCashAuditNfeInput,
  type OrderToCashAuditNfeLinkInput,
  type OrderToCashAuditReceivableInput,
  type OrderToCashAuditStockDocumentInput,
  type OrderToCashAuditStockItemInput,
} from "../src/lib/sales/orderToCashAuditBuilder.ts";
import { resolveOrderToCashAuditLineBilledValue } from "../src/lib/finance/orderToCashAuditApi.ts";

const ORDER_CODE = "PD 02534";
const NFE_NUMBER = "7228";
const STOCK_DOC_EXTERNAL_ID = 8457;

const prisma = new PrismaClient();

function dec(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function summarizeRows(
  rows: Array<{
    productCode?: string | null;
    sku?: string | null;
    lineType?: string | null;
    quantityUsedForOrder?: number | null;
    stockDocumentItemExternalProductId?: number | null;
    stockDocumentItemUnitValue?: number | null;
    excessQuantity?: number | null;
    outsideOrderQuantity?: number | null;
    allocatedValueByDocumentPrice?: number | null;
    nfeNumber?: string | null;
    receivableTotalValue?: number | null;
    stockDocumentExternalId?: number | null;
  }>
) {
  return rows.map((r) => {
    const billed = resolveOrderToCashAuditLineBilledValue({
      lineType: r.lineType,
      quantityUsedForOrder: r.quantityUsedForOrder,
      excessQuantity: r.excessQuantity,
      outsideOrderQuantity: r.outsideOrderQuantity,
      stockDocumentItemUnitValue: r.stockDocumentItemUnitValue,
      allocatedValueByDocumentPrice: r.allocatedValueByDocumentPrice,
    });
    return {
      productCode: r.productCode ?? r.sku,
      lineType: r.lineType,
      externalProductId: r.stockDocumentItemExternalProductId,
      qtyUsed: r.quantityUsedForOrder,
      unit: r.stockDocumentItemUnitValue,
      lineBilledValue: billed.lineBilledValue,
      lineBilledValueSource: billed.lineBilledValueSource,
      nfeNumber: r.nfeNumber,
      receivableTotalValue: r.receivableTotalValue,
      stockDocumentExternalId: r.stockDocumentExternalId,
    };
  });
}

async function main(): Promise<void> {
  console.log(`=== inspect PD 02534 OrderToCash (DB vs rebuild memória) ===\n`);

  const order = await prisma.salesOrder.findFirst({
    where: { orderCode: ORDER_CODE },
    include: {
      Customer: { select: { companyName: true, tradeName: true } },
      items: { orderBy: { createdAt: "asc" } },
      nfeLinks: true,
    },
  });

  if (!order) {
    console.log(`FAIL — pedido ${ORDER_CODE} não encontrado.`);
    process.exitCode = 1;
    return;
  }

  console.log("--- Pedido ---");
  console.log(
    JSON.stringify(
      {
        id: order.id,
        orderCode: order.orderCode,
        externalSalesOrderId: order.externalSalesOrderId,
        customer: order.Customer.tradeName ?? order.Customer.companyName,
        externalCustomerId: order.externalCustomerId,
        items: order.items.map((it, idx) => ({
          sequence: idx + 1,
          externalProductId: it.externalProductId,
          sku: it.skuSnapshot,
          qty: dec(it.quantity),
          unitPrice: dec(it.negotiatedPrice),
        })),
      },
      null,
      2
    )
  );

  const stockDoc = await prisma.nomusStockDocument.findFirst({
    where: { externalId: STOCK_DOC_EXTERNAL_ID },
    include: { items: true },
  });
  console.log(`\n--- Documento ${STOCK_DOC_EXTERNAL_ID} ---`);
  console.log(
    JSON.stringify(
      stockDoc
        ? {
            externalId: stockDoc.externalId,
            idNfe: stockDoc.idNfe,
            items: stockDoc.items.map((it) => ({
              externalProductId: it.externalProductId,
              quantity: dec(it.quantity),
              unitValue: dec(it.unitValue),
            })),
          }
        : null,
      null,
      2
    )
  );

  const factAnchor = await prisma.orderToCashAuditFact.findFirst({
    where: { orderCode: ORDER_CODE, run: { status: "SUCCESS" } },
    orderBy: { createdAt: "desc" },
    select: { runId: true },
  });

  if (factAnchor) {
    const dbFacts = await prisma.orderToCashAuditFact.findMany({
      where: { runId: factAnchor.runId, orderCode: ORDER_CODE },
      orderBy: [{ lineType: "asc" }, { productCode: "asc" }],
    });
    console.log(`\n--- Facts no banco (run=${factAnchor.runId}) — ANTES/ATUAL ---`);
    console.log(JSON.stringify(summarizeRows(dbFacts), null, 2));
  } else {
    console.log("\n(nenhum fact SUCCESS no banco para este pedido)");
  }

  const nfeExtIds = [...new Set(order.nfeLinks.map((l) => l.nfeExternalId))];
  const nfesRaw =
    nfeExtIds.length > 0
      ? await prisma.nomusNfe.findMany({ where: { externalId: { in: nfeExtIds } } })
      : [];
  const receivables =
    nfeExtIds.length > 0
      ? await prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: nfeExtIds } },
        })
      : [];

  const orderInput: OrderToCashAuditOrderInput = {
    id: order.id,
    externalSalesOrderId: order.externalSalesOrderId,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalNetValue: dec(order.totalNetValue) ?? 0,
    totalGrossValue: dec(order.totalGrossValue),
    paymentTerms: order.paymentTerms,
    customerId: order.customerId,
    externalCustomerId: order.externalCustomerId,
    customerName: order.Customer.tradeName ?? order.Customer.companyName,
    sellerName: order.nomusSellerName,
    externalSellerId: order.externalSellerId,
    sellerSource: "SALES_ORDER",
  };

  const orderItems: OrderToCashAuditOrderItemInput[] = order.items.map((it, index) => ({
    id: it.id,
    salesOrderId: order.id,
    orderItemSequence: index + 1,
    externalProductId: it.externalProductId,
    productId: it.productId,
    productCode: it.skuSnapshot,
    sku: it.skuSnapshot,
    productName: it.productNameSnapshot,
    quantity: dec(it.quantity) ?? 0,
    unitPrice: dec(it.negotiatedPrice) ?? 0,
    totalNetValue: dec(it.totalNetValue),
  }));

  const nfeLinks: OrderToCashAuditNfeLinkInput[] = order.nfeLinks.map((l) => ({
    salesOrderId: order.id,
    nfeExternalId: l.nfeExternalId,
    nfeNumber: l.nfeNumber,
    nfeSerie: l.nfeSerie,
    nfeKey: l.nfeKey,
    nfeStatus: l.nfeStatus,
    tipoOperacao: l.tipoOperacao,
    dataProcessamento: l.dataProcessamento,
    nomusNfeId: l.nomusNfeId,
  }));

  const nfes: OrderToCashAuditNfeInput[] = nfesRaw.map((n) => ({
    id: n.id,
    externalId: n.externalId,
    numero: n.numero,
    serie: n.serie,
    chave: n.chave,
    status: n.status,
    tipoOperacao: n.tipoOperacao,
    dataProcessamento: n.dataProcessamento,
    issueDate: n.xmlDhEmi ?? n.dataProcessamento,
    valorLiquido: dec(n.valorLiquido),
  }));

  const stockDocuments: OrderToCashAuditStockDocumentInput[] = stockDoc
    ? [
        {
          id: stockDoc.id,
          externalId: stockDoc.externalId,
          idNfe: stockDoc.idNfe,
          tipoDocumentoEstoque: stockDoc.tipoDocumentoEstoque,
          dataDocumento: stockDoc.dataDocumento,
          items: stockDoc.items.map((it) => ({
            id: it.id,
            stockDocumentId: stockDoc.id,
            externalProductId: it.externalProductId,
            quantity: dec(it.quantity) ?? 0,
            unitValue: dec(it.unitValue) ?? 0,
            estimatedTotalValue: dec(it.estimatedTotalValue),
          })),
        },
      ]
    : [];

  const stockDocumentItems: OrderToCashAuditStockItemInput[] = stockDocuments.flatMap(
    (d) => d.items ?? []
  );

  const recvInputs: OrderToCashAuditReceivableInput[] = receivables.map((r) => ({
    id: r.id,
    externalId: r.externalId,
    sourceInvoiceId: r.sourceInvoiceId,
    amountReceivable: dec(r.amountReceivable),
    amountReceived: dec(r.amountReceived),
    balanceReceivable: dec(r.balanceReceivable),
    dueDate: r.dueDate,
    settlementDate: r.settlementDate,
  }));

  const rebuilt = buildOrderToCashAuditRows({
    orders: [orderInput],
    orderItems,
    nfeLinks,
    nfes,
    stockDocuments,
    stockDocumentItems,
    receivables: recvInputs,
    options: { today: new Date() },
  });

  console.log(`\n--- Rebuild em memória (DEPOIS da correção) — NF ${NFE_NUMBER} ---`);
  console.log(JSON.stringify(summarizeRows(rebuilt.rows), null, 2));
  console.log("\nsummary:", rebuilt.summary);
  console.log("\n=== fim inspect PD 02534 ===");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
