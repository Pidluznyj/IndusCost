/**
 * Diagnóstico OrderToCashAudit — PD 02534 (NF 7228 / doc 8457).
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-order-to-cash-pd02534.ts
 *
 * Read-only — não altera tabelas oficiais.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
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

async function main(): Promise<void> {
  console.log(`=== inspect OrderToCashAudit ${ORDER_CODE} ===\n`);

  const order = await prisma.salesOrder.findFirst({
    where: { orderCode: ORDER_CODE },
    include: {
      Customer: { select: { companyName: true, tradeName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          Product: { select: { sku: true, name: true, sourceExternalId: true } },
        },
      },
    },
  });

  console.log("--- Pedido ---");
  if (!order) {
    console.log(`Pedido ${ORDER_CODE} não encontrado em SalesOrder.`);
  } else {
    console.log(
      JSON.stringify(
        {
          id: order.id,
          orderCode: order.orderCode,
          customerName: order.Customer?.tradeName ?? order.Customer?.companyName ?? null,
          totalNetValue: dec(order.totalNetValue),
          totalGrossValue: dec(order.totalGrossValue),
          itemCount: order.items.length,
        },
        null,
        2
      )
    );
    console.log("--- Itens do pedido ---");
    for (const item of order.items) {
      console.log(
        JSON.stringify(
          {
            id: item.id,
            productCode: item.Product?.sourceExternalId ?? item.Product?.sku ?? null,
            sku: item.skuSnapshot,
            productName: item.productNameSnapshot,
            quantity: dec(item.quantity),
            unitPrice: dec(item.negotiatedPrice),
            totalNetValue: dec(item.totalNetValue),
          },
          null,
          2
        )
      );
    }
  }

  const nfe = await prisma.nomusNfe.findFirst({
    where: { numero: NFE_NUMBER },
    select: {
      id: true,
      externalId: true,
      numero: true,
      serie: true,
      valorLiquido: true,
      xmlVNF: true,
      xmlDhEmi: true,
      dataProcessamento: true,
    },
  });

  console.log(`\n--- NF ${NFE_NUMBER} ---`);
  if (!nfe) {
    console.log("NF não encontrada em NomusNfe.");
  } else {
    console.log(
      JSON.stringify(
        {
          id: nfe.id,
          externalId: nfe.externalId,
          numero: nfe.numero,
          serie: nfe.serie,
          valorLiquido: dec(nfe.valorLiquido),
          xmlVNF: dec(nfe.xmlVNF),
          xmlDhEmi: nfe.xmlDhEmi,
          dataProcessamento: nfe.dataProcessamento,
          note: "Itens de NF vêm dos facts (nfeItem*); NomusNfe não materializa itens tipados.",
        },
        null,
        2
      )
    );
  }

  const stockDoc = await prisma.nomusStockDocument.findFirst({
    where: { externalId: STOCK_DOC_EXTERNAL_ID },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          externalProductId: true,
          quantity: true,
          unitValue: true,
          estimatedTotalValue: true,
        },
      },
    },
  });

  console.log(`\n--- Documento ${STOCK_DOC_EXTERNAL_ID} ---`);
  if (!stockDoc) {
    console.log("Documento de saída não encontrado em NomusStockDocument.");
  } else {
    console.log(
      JSON.stringify(
        {
          id: stockDoc.id,
          externalId: stockDoc.externalId,
          tipoDocumentoEstoque: stockDoc.tipoDocumentoEstoque,
          dataDocumento: stockDoc.dataDocumento,
          idNfe: stockDoc.idNfe,
          items: stockDoc.items.map((it) => ({
            id: it.id,
            externalProductId: it.externalProductId,
            quantity: dec(it.quantity),
            unitValue: dec(it.unitValue),
            estimatedTotalValue: dec(it.estimatedTotalValue),
          })),
        },
        null,
        2
      )
    );
  }

  const factAnchor = await prisma.orderToCashAuditFact.findFirst({
    where: {
      orderCode: ORDER_CODE,
      run: { status: "SUCCESS" },
    },
    orderBy: { createdAt: "desc" },
    select: { runId: true },
  });

  if (!factAnchor) {
    console.log(`\nFAIL — nenhum fact SUCCESS para ${ORDER_CODE}.`);
    process.exitCode = 1;
    return;
  }

  const facts = await prisma.orderToCashAuditFact.findMany({
    where: { runId: factAnchor.runId, orderCode: ORDER_CODE },
    orderBy: [{ lineType: "asc" }, { productCode: "asc" }, { createdAt: "asc" }],
  });

  console.log(`\n--- Facts OrderToCashAuditFact (run=${factAnchor.runId}) ---`);
  console.log(`facts: ${facts.length}`);

  for (const row of facts) {
    const stockDocumentItemQuantity = dec(row.stockDocumentItemQuantity);
    const stockDocumentItemUnitValue = dec(row.stockDocumentItemUnitValue);
    const stockDocumentItemTotalValue = dec(row.stockDocumentItemTotalValue);
    const nfeItemQuantity = dec(row.nfeItemQuantity);
    const nfeItemUnitValue = dec(row.nfeItemUnitValue);
    const nfeItemTotalValue = dec(row.nfeItemTotalValue);
    const allocatedValueByDocumentPrice = dec(row.allocatedValueByDocumentPrice);
    const billed = resolveOrderToCashAuditLineBilledValue({
      stockDocumentItemTotalValue,
      stockDocumentItemQuantity,
      stockDocumentItemUnitValue,
      nfeItemTotalValue,
      nfeItemQuantity,
      nfeItemUnitValue,
      allocatedValueByDocumentPrice,
    });

    console.log(
      JSON.stringify(
        {
          productCode: row.productCode,
          lineType: row.lineType,
          orderItemTotalValue: dec(row.orderItemTotalValue),
          stockDocumentExternalId: row.stockDocumentExternalId,
          stockDocumentItemQuantity,
          stockDocumentItemUnitValue,
          stockDocumentItemTotalValue,
          nfeNumber: row.nfeNumber,
          nfeItemQuantity,
          nfeItemUnitValue,
          nfeItemTotalValue,
          allocatedValueByOrderPrice: dec(row.allocatedValueByOrderPrice),
          allocatedValueByDocumentPrice,
          receivableTotalValue: dec(row.receivableTotalValue),
          lineBilledValue: billed.lineBilledValue,
          lineBilledValueSource: billed.lineBilledValueSource,
          lineBilledValueLabel: billed.lineBilledValueLabel,
        },
        null,
        2
      )
    );
  }

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
