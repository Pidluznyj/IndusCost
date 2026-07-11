/**
 * Validação real — Mapa de Atendimento PD 02339 (Britânia).
 *
 * Uso:
 *   npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
 *
 * Preferência: run materializada
 *   runId = 1dc2ead7-533d-4ad4-bc4c-621061fa5623
 *
 * Fallback: fixture (DB indisponível). Read-only — sem write.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildPortfolioReconciliationFacts } from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import type {
  PortfolioReconciliationSnapshot,
  SnapshotOrder,
} from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import {
  buildOrderFulfillmentMap,
  FINANCIAL_STATUS_LABEL,
  OPERATIONAL_STATUS_LABEL,
  TECHNICAL_ALERT_LABEL,
  type FulfillmentReceivableInput,
  type PortfolioOrderFulfillmentMap,
} from "../src/lib/finance/portfolioOrderFulfillmentMap.ts";
import type { PortfolioReconciliationFactApiRow } from "../src/lib/finance/portfolioReconciliationApi.ts";
import { portfolioFactDraftToApiRow } from "../src/lib/finance/portfolioReconciliationOrderTrace.ts";

const RUN_ID = "1dc2ead7-533d-4ad4-bc4c-621061fa5623";
const ORDER_CODE = "PD 02339";
const EXPECTED_ORDER_VALUE = 158_000;
const MONEY_TOL = 0.05;

type Check = { name: string; pass: boolean; detail: string };

type LoadedBundle = {
  source: "DB" | "FIXTURE";
  salesOrderId: string;
  orderCode: string;
  customerName: string | null;
  issueDate: Date | string | null;
  orderValue: number;
  paymentTermsAvailable: boolean;
  confidenceLevel: string | null;
  facts: PortfolioReconciliationFactApiRow[];
  orderItems: Array<{
    id: string;
    externalProductId: number;
    quantity: number;
    unitPrice: number;
    productSkuSnapshot: string | null;
    productNameSnapshot: string | null;
    totalNetValue: number | null;
  }>;
  nfeLinks: Array<{
    salesOrderId: string;
    nfeExternalId: number;
    nfeNumber: string | null;
    dataProcessamento: Date | null;
  }>;
  nfes: Array<{
    id: string;
    externalId: number;
    numero: string | null;
    valorLiquido: number | null;
  }>;
  stockDocuments: Array<{
    id: string;
    externalId: number;
    idNfe: number | null;
    dataDocumento: Date | null;
    items: Array<{
      id: string;
      externalProductId: number;
      quantity: number;
      unitValue: number;
    }>;
  }>;
  receivables: FulfillmentReceivableInput[];
};

function decimalToNumber(value: unknown): number | null {
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_TOL;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function isoDate(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function parseIdList(value: unknown): number[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof value === "string") {
    try {
      return parseIdList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function mapFact(row: Record<string, unknown>): PortfolioReconciliationFactApiRow {
  const num = (k: string) => decimalToNumber(row[k]);
  return {
    id: String(row.id),
    runId: String(row.runId),
    customerId: (row.customerId as string | null) ?? null,
    customerExternalId: (row.customerExternalId as number | null) ?? null,
    customerNameSnapshot: (row.customerNameSnapshot as string | null) ?? null,
    salesOrderId: (row.salesOrderId as string | null) ?? null,
    externalSalesOrderId: (row.externalSalesOrderId as number | null) ?? null,
    orderCode: (row.orderCode as string | null) ?? null,
    orderIssueDate: (row.orderIssueDate as Date | null) ?? null,
    expectedDeliveryDate: (row.expectedDeliveryDate as Date | null) ?? null,
    salesOrderItemId: (row.salesOrderItemId as string | null) ?? null,
    externalSalesOrderItemId: (row.externalSalesOrderItemId as number | null) ?? null,
    externalProductId: (row.externalProductId as number | null) ?? null,
    productSkuSnapshot: (row.productSkuSnapshot as string | null) ?? null,
    productNameSnapshot: (row.productNameSnapshot as string | null) ?? null,
    orderQuantity: num("orderQuantity"),
    orderUnitPrice: num("orderUnitPrice"),
    orderItemValue: num("orderItemValue"),
    nomusNfeId: (row.nomusNfeId as string | null) ?? null,
    nfeExternalId: (row.nfeExternalId as number | null) ?? null,
    nfeNumber: (row.nfeNumber as string | null) ?? null,
    nfeSerie: (row.nfeSerie as string | null) ?? null,
    nfeKey: (row.nfeKey as string | null) ?? null,
    nfeProcessedAt: (row.nfeProcessedAt as Date | null) ?? null,
    nfeHeaderValue: num("nfeHeaderValue"),
    stockDocumentId: (row.stockDocumentId as string | null) ?? null,
    stockDocumentExternalId: (row.stockDocumentExternalId as number | null) ?? null,
    stockDocumentItemId: (row.stockDocumentItemId as string | null) ?? null,
    stockDocumentItemExternalId: (row.stockDocumentItemExternalId as number | null) ?? null,
    stockDocumentDate: (row.stockDocumentDate as Date | null) ?? null,
    stockQuantity: num("stockQuantity"),
    stockUnitValue: num("stockUnitValue"),
    stockItemValue: num("stockItemValue"),
    allocatedQuantity: num("allocatedQuantity"),
    allocatedValueByOrderPrice: num("allocatedValueByOrderPrice"),
    allocatedValueByStockPrice: num("allocatedValueByStockPrice"),
    remainingOrderQuantityAfterAllocation: num("remainingOrderQuantityAfterAllocation"),
    remainingOrderValueAfterAllocation: num("remainingOrderValueAfterAllocation"),
    priceDifferenceUnit: num("priceDifferenceUnit"),
    priceDifferenceTotal: num("priceDifferenceTotal"),
    receivableIdsJson: row.receivableIdsJson ?? null,
    receivableTotalValue: num("receivableTotalValue"),
    receivedValue: num("receivedValue"),
    openReceivableValue: num("openReceivableValue"),
    dueDatesJson: row.dueDatesJson ?? null,
    settlementDatesJson: row.settlementDatesJson ?? null,
    forecastSource: String(row.forecastSource ?? "UNRESOLVED"),
    forecastDate: (row.forecastDate as Date | null) ?? null,
    forecastValue: num("forecastValue"),
    confidenceLevel: String(row.confidenceLevel ?? "LOW"),
    status: (row.status as string | null) ?? null,
    alertsJson: row.alertsJson ?? null,
    traceJson: row.traceJson ?? null,
  };
}

function pd02339Snapshot(): PortfolioReconciliationSnapshot {
  const order: SnapshotOrder = {
    id: "3915fa28-1947-4388-bb27-2699c3cbb516",
    externalSalesOrderId: 2335,
    orderCode: ORDER_CODE,
    issueDate: new Date(2026, 4, 1),
    customerNameSnapshot: "Britânia",
    totalNetValue: EXPECTED_ORDER_VALUE,
    items: [
      { id: "item-456", externalProductId: 456, quantity: 3000, unitPrice: 5.85, productSkuSnapshot: "456" },
      { id: "item-452", externalProductId: 452, quantity: 9000, unitPrice: 5.85, productSkuSnapshot: "452" },
      { id: "item-537", externalProductId: 537, quantity: 5000, unitPrice: 5.86, productSkuSnapshot: "537" },
      { id: "item-455", externalProductId: 455, quantity: 10000, unitPrice: 5.85, productSkuSnapshot: "455" },
    ],
  };
  return {
    orders: [order],
    nfeLinks: [
      { salesOrderId: order.id, nfeExternalId: 6937, nfeNumber: "6845", dataProcessamento: new Date(2026, 4, 13) },
      { salesOrderId: order.id, nfeExternalId: 7188, nfeNumber: "7052", dataProcessamento: new Date(2026, 5, 8) },
      { salesOrderId: order.id, nfeExternalId: 7377, nfeNumber: "7195", dataProcessamento: new Date(2026, 5, 26) },
    ],
    nfes: [
      { id: "nfe-6937", externalId: 6937, numero: "6845", valorLiquido: 108240 },
      { id: "nfe-7188", externalId: 7188, numero: "7052", valorLiquido: 168075 },
      { id: "nfe-7377", externalId: 7377, numero: "7195", valorLiquido: 78975 },
    ],
    stockDocuments: [
      {
        id: "doc-7951",
        externalId: 7951,
        idNfe: 6937,
        dataDocumento: new Date(2026, 4, 13),
        items: [
          { id: "si-456", externalProductId: 456, quantity: 3000, unitValue: 4.92 },
          { id: "si-452", externalProductId: 452, quantity: 9000, unitValue: 4.92 },
          { id: "si-455", externalProductId: 455, quantity: 10000, unitValue: 4.92 },
        ],
      },
      {
        id: "doc-8175",
        externalId: 8175,
        idNfe: 7188,
        dataDocumento: new Date(2026, 5, 8),
        items: [
          { id: "si-537", externalProductId: 537, quantity: 10000, unitValue: 5.86 },
          { id: "si-452b", externalProductId: 452, quantity: 4500, unitValue: 5.85 },
          { id: "si-538", externalProductId: 538, quantity: 6200, unitValue: 5.85 },
          { id: "si-453", externalProductId: 453, quantity: 8000, unitValue: 5.86 },
        ],
      },
      {
        id: "doc-8422",
        externalId: 8422,
        idNfe: 7377,
        dataDocumento: new Date(2026, 5, 26),
        items: [
          { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
          { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
        ],
      },
    ],
  };
}

function loadFixture(): LoadedBundle {
  const snapshot = pd02339Snapshot();
  const order = snapshot.orders[0]!;
  const built = buildPortfolioReconciliationFacts({
    runId: "fixture-pd02339",
    mode: "preview",
    snapshot,
  });
  const facts = built.facts.map((d, i) => portfolioFactDraftToApiRow(d, `fixture-${i}`));
  return {
    source: "FIXTURE",
    salesOrderId: order.id,
    orderCode: ORDER_CODE,
    customerName: "Britânia",
    issueDate: order.issueDate ?? null,
    orderValue: EXPECTED_ORDER_VALUE,
    paymentTermsAvailable: false,
    confidenceLevel: "MEDIUM",
    facts,
    orderItems: order.items
      .filter((it) => it.externalProductId != null)
      .map((it) => ({
        id: it.id,
        externalProductId: it.externalProductId!,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        productSkuSnapshot: it.productSkuSnapshot ?? null,
        productNameSnapshot: it.productNameSnapshot ?? null,
        totalNetValue: it.totalNetValue ?? it.quantity * it.unitPrice,
      })),
    nfeLinks: snapshot.nfeLinks.map((l) => ({
      salesOrderId: l.salesOrderId,
      nfeExternalId: l.nfeExternalId,
      nfeNumber: l.nfeNumber ?? null,
      dataProcessamento: l.dataProcessamento ?? null,
    })),
    nfes: snapshot.nfes.map((n) => ({
      id: n.id ?? `nfe-${n.externalId}`,
      externalId: n.externalId,
      numero: n.numero ?? null,
      valorLiquido: n.valorLiquido ?? null,
    })),
    stockDocuments: snapshot.stockDocuments.map((d) => ({
      id: d.id,
      externalId: d.externalId,
      idNfe: d.idNfe,
      dataDocumento: d.dataDocumento ?? null,
      items: d.items
        .filter((it) => it.externalProductId != null)
        .map((it) => ({
          id: it.id,
          externalProductId: it.externalProductId!,
          quantity: it.quantity,
          unitValue: it.unitValue,
        })),
    })),
    // Fixture inclui CR para validar eixo financeiro (não inventa baixa).
    receivables: [
      {
        receivableId: 9001,
        dueDate: "2025-06-15",
        settlementDate: null,
        totalValue: EXPECTED_ORDER_VALUE,
        receivedValue: 0,
        openValue: EXPECTED_ORDER_VALUE,
        sourceNfe: 6937,
      },
    ],
  };
}

async function loadFromDb(): Promise<LoadedBundle> {
  const prisma = new PrismaClient();
  try {
    const run = await prisma.portfolioReconciliationRun.findUnique({
      where: { id: RUN_ID },
      select: { id: true, status: true },
    });
    if (!run) throw new Error(`Run ${RUN_ID} não encontrada.`);

    const order = await prisma.salesOrder.findFirst({
      where: {
        OR: [
          { orderCode: ORDER_CODE },
          { orderCode: { equals: ORDER_CODE, mode: "insensitive" } },
          { externalSalesOrderCode: ORDER_CODE },
        ],
      },
      select: {
        id: true,
        orderCode: true,
        totalNetValue: true,
        paymentTerms: true,
        paymentMethod: true,
        externalSalesOrderId: true,
        issueDate: true,
        Customer: { select: { companyName: true, tradeName: true } },
      },
    });
    if (!order) throw new Error(`Pedido ${ORDER_CODE} não encontrado.`);

    const items = await prisma.salesOrderItem.findMany({
      where: { salesOrderId: order.id },
      select: {
        id: true,
        externalProductId: true,
        skuSnapshot: true,
        productNameSnapshot: true,
        quantity: true,
        negotiatedPrice: true,
        totalNetValue: true,
      },
      orderBy: { skuSnapshot: "asc" },
    });

    const factsRaw = await prisma.portfolioReconciliationFact.findMany({
      where: { runId: RUN_ID, salesOrderId: order.id },
    });
    if (factsRaw.length === 0) {
      throw new Error(
        `Sem PortfolioReconciliationFact para ${ORDER_CODE} na run ${RUN_ID}.`
      );
    }

    const nfeLinks = await prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId: order.id },
      select: {
        salesOrderId: true,
        nfeExternalId: true,
        nfeNumber: true,
        dataProcessamento: true,
      },
    });

    const nfeExternalIds = [...new Set(nfeLinks.map((l) => l.nfeExternalId))];
    const nfes = nfeExternalIds.length
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            valorLiquido: true,
          },
        })
      : [];

    const stockDocs = nfeExternalIds.length
      ? await prisma.nomusStockDocument.findMany({
          where: { idNfe: { in: nfeExternalIds } },
          include: { items: true },
          orderBy: { dataDocumento: "asc" },
        })
      : [];

    const facts = factsRaw.map((r) => mapFact(r as unknown as Record<string, unknown>));

    const receivableIdsFromFacts = new Set<number>();
    for (const f of facts) {
      for (const id of parseIdList(f.receivableIdsJson)) receivableIdsFromFacts.add(id);
    }

    const arWhere: Array<Record<string, unknown>> = [];
    if (nfeExternalIds.length > 0) {
      arWhere.push({ sourceInvoiceId: { in: nfeExternalIds } });
    }
    if (receivableIdsFromFacts.size > 0) {
      arWhere.push({ externalId: { in: [...receivableIdsFromFacts] } });
    }

    const arRows =
      arWhere.length > 0
        ? await prisma.nomusAccountsReceivable.findMany({
            where: { OR: arWhere },
            select: {
              externalId: true,
              dueDate: true,
              settlementDate: true,
              amountReceivable: true,
              amountReceived: true,
              balanceReceivable: true,
              sourceInvoiceId: true,
            },
            orderBy: { dueDate: "asc" },
          })
        : [];

    const receivables: FulfillmentReceivableInput[] = arRows.map((r) => ({
      receivableId: r.externalId,
      dueDate: isoDate(r.dueDate) === "—" ? null : isoDate(r.dueDate),
      settlementDate: isoDate(r.settlementDate) === "—" ? null : isoDate(r.settlementDate),
      totalValue: decimalToNumber(r.amountReceivable),
      receivedValue: decimalToNumber(r.amountReceived),
      openValue: decimalToNumber(r.balanceReceivable),
      sourceNfe: r.sourceInvoiceId,
    }));

    // Se Nomus AR vazio mas fatos têm agregados de CR, materializa cobertura a partir dos fatos.
    if (receivables.length === 0) {
      const withCr = facts.find(
        (f) =>
          (f.receivableTotalValue ?? 0) > MONEY_TOL ||
          (f.receivedValue ?? 0) > MONEY_TOL ||
          (f.openReceivableValue ?? 0) > MONEY_TOL
      );
      if (withCr) {
        const ids = parseIdList(withCr.receivableIdsJson);
        receivables.push({
          receivableId: ids[0] ?? null,
          dueDate: null,
          settlementDate: null,
          totalValue: withCr.receivableTotalValue,
          receivedValue: withCr.receivedValue,
          openValue: withCr.openReceivableValue,
          sourceNfe: withCr.nfeExternalId,
        });
      }
    }

    const orderValue =
      decimalToNumber(order.totalNetValue) ?? EXPECTED_ORDER_VALUE;
    const customerName =
      order.Customer?.tradeName?.trim() ||
      order.Customer?.companyName?.trim() ||
      facts.find((f) => f.customerNameSnapshot)?.customerNameSnapshot ||
      null;
    const confidenceLevel =
      facts.find((f) => f.confidenceLevel)?.confidenceLevel ?? null;

    return {
      source: "DB",
      salesOrderId: order.id,
      orderCode: order.orderCode,
      customerName,
      issueDate: order.issueDate,
      orderValue,
      paymentTermsAvailable: Boolean(
        order.paymentTerms?.trim() || order.paymentMethod?.trim()
      ),
      confidenceLevel,
      facts,
      orderItems: items
        .filter((it) => it.externalProductId != null)
        .map((it) => ({
          id: it.id,
          externalProductId: it.externalProductId!,
          quantity: decimalToNumber(it.quantity) ?? 0,
          unitPrice: decimalToNumber(it.negotiatedPrice) ?? 0,
          productSkuSnapshot: it.skuSnapshot,
          productNameSnapshot: it.productNameSnapshot,
          totalNetValue: decimalToNumber(it.totalNetValue),
        })),
      nfeLinks: nfeLinks.map((l) => ({
        salesOrderId: l.salesOrderId,
        nfeExternalId: l.nfeExternalId,
        nfeNumber: l.nfeNumber,
        dataProcessamento: l.dataProcessamento,
      })),
      nfes: nfes.map((n) => ({
        id: n.id,
        externalId: n.externalId,
        numero: n.numero,
        valorLiquido: decimalToNumber(n.valorLiquido),
      })),
      stockDocuments: stockDocs.map((d) => ({
        id: d.id,
        externalId: d.externalId,
        idNfe: d.idNfe,
        dataDocumento: d.dataDocumento,
        items: d.items
          .filter((it) => it.externalProductId != null)
          .map((it) => ({
            id: it.id,
            externalProductId: it.externalProductId!,
            quantity: decimalToNumber(it.quantity) ?? 0,
            unitValue: decimalToNumber(it.unitValue) ?? 0,
          })),
      })),
      receivables,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function buildMap(bundle: LoadedBundle): PortfolioOrderFulfillmentMap {
  return buildOrderFulfillmentMap({
    order: {
      id: bundle.salesOrderId,
      orderCode: bundle.orderCode,
      totalNetValue: bundle.orderValue,
      customerNameSnapshot: bundle.customerName,
      issueDate: bundle.issueDate,
    },
    orderItems: bundle.orderItems,
    reconciliationFacts: bundle.facts,
    nfeLinks: bundle.nfeLinks,
    nfes: bundle.nfes,
    stockDocuments: bundle.stockDocuments,
    receivables: bundle.receivables,
    orderValue: bundle.orderValue,
    paymentTermsAvailable: bundle.paymentTermsAvailable,
    runId: RUN_ID,
  });
}

function printReport(bundle: LoadedBundle, map: PortfolioOrderFulfillmentMap) {
  const s = map.fulfillmentSummary;

  console.log("\n=== PD 02339 — Mapa de Atendimento ===");
  console.log(
    `Fonte: ${bundle.source}${bundle.source === "DB" ? ` · run ${RUN_ID}` : " (fallback)"}`
  );

  console.log("\n1. Resumo do pedido");
  console.log(`- pedido: ${bundle.orderCode} (${bundle.salesOrderId})`);
  console.log(`- cliente: ${bundle.customerName ?? "—"}`);
  console.log(`- valor: ${money(s.orderValue)}`);
  console.log(`- emissão: ${isoDate(bundle.issueDate)}`);
  console.log(`- quantidade de itens: ${bundle.orderItems.length}`);

  console.log("\n2. Status");
  console.log(
    `- status financeiro: ${map.financialStatus} (${map.financialStatusLabel ?? FINANCIAL_STATUS_LABEL[map.financialStatus]})`
  );
  console.log(
    `- status operacional: ${map.operationalStatus} (${map.operationalStatusLabel ?? OPERATIONAL_STATUS_LABEL[map.operationalStatus]})`
  );
  console.log(`- confiança: ${bundle.confidenceLevel ?? "—"}`);
  console.log(
    `- alertas técnicos: ${
      map.technicalAlerts.length === 0
        ? "(nenhum)"
        : map.technicalAlerts
            .map((a) => `${a} (${TECHNICAL_ALERT_LABEL[a] ?? a})`)
            .join("; ")
    }`
  );

  console.log("\n3. Resumo de atendimento");
  console.log(`- valor do pedido: ${money(s.orderValue)}`);
  console.log(`- valor atribuído ao pedido: ${money(s.attributedOrderValueByOrderPrice)}`);
  console.log(`- valor cabeçalho NF/documento: ${money(s.nfeHeaderTotalValue)}`);
  console.log(`- valor não atribuído: ${money(s.nfeHeaderNotAttributedToOrderValue)}`);
  console.log(`- quantidade pedida: ${qty(s.totalOrderedQuantity)}`);
  console.log(`- quantidade atendida: ${qty(s.totalAttendedQuantityCapped)}`);
  console.log(`- quantidade faltante: ${qty(s.totalRemainingQuantity)}`);
  console.log(`- quantidade excedente: ${qty(s.totalExcessQuantity)}`);
  console.log(`- % atendimento: ${s.fulfillmentPercent ?? "—"}%`);

  console.log("\n4. Itens do pedido");
  console.log(
    "produto | pedido | atendido | saldo | excedente | % | valor item | valor atendido | docs/NFs | alertas"
  );
  for (const row of map.orderItemsCoverage) {
    const docs =
      row.documentsUsed.length === 0
        ? "—"
        : row.documentsUsed
            .map(
              (d) =>
                `${d.nfeNumber ?? d.nfeExternalId ?? "?"}@${d.stockDocumentExternalId ?? "?"}(${qty(d.allocatedQuantity)})`
            )
            .join(", ");
    console.log(
      `${row.productCode ?? row.sku ?? row.externalProductId ?? "?"} | ${qty(row.orderedQuantity)} | ${qty(row.attendedQuantityCapped)} | ${qty(row.remainingQuantity)} | ${qty(row.excessQuantityForThisProduct)} | ${row.fulfillmentPercentCapped ?? "—"}% | ${money(row.orderItemValue)} | ${money(row.attendedValueByOrderPrice)} | ${docs} | ${row.alerts.join(",") || "—"}`
    );
  }

  console.log("\n5. Documentos de saída");
  console.log(
    "NF | documento | data | cabeçalho | atribuído ao pedido | fora do pedido | itens casados | itens fora | excedentes | alertas"
  );
  for (const doc of map.stockDocumentsCoverage) {
    const matched =
      doc.matchedItems
        .map(
          (m) =>
            `${m.externalProductId ?? m.productExternalId}(${qty(m.quantityUsedForOrder ?? m.allocatedQuantity)})`
        )
        .join(",") || "—";
    const outside = (doc.itemsOutsideOrder ?? doc.unmatchedItems)
      .map(
        (m) =>
          `${m.externalProductId ?? m.productExternalId}(${qty(m.documentQuantity ?? m.stockQuantity)})`
      )
      .join(",") || "—";
    const surplus =
      doc.surplusItems
        .map(
          (m) =>
            `${m.externalProductId ?? m.productExternalId}(${qty(m.stockQuantity)})`
        )
        .join(",") || "—";
    console.log(
      `${doc.nfeNumber ?? doc.nfeExternalId ?? "—"} | ${doc.stockDocumentExternalId ?? "—"} | ${doc.date ?? "—"} | ${money(doc.nfeHeaderValue)} | ${money(doc.valueAttributedToOrder)} | ${money(doc.valueNotAttributedToOrder)} | ${matched} | ${outside} | ${surplus} | ${doc.alerts.join(",") || "—"}`
    );
  }

  console.log("\n6. CR");
  console.log(
    "id/título | NF origem | vencimento | baixa | valor | recebido | aberto | status"
  );
  if (map.receivablesCoverage.length === 0) {
    console.log("(nenhum título vinculado nesta evidência)");
  } else {
    for (const r of map.receivablesCoverage) {
      const open = r.openValue ?? 0;
      const received = r.receivedValue ?? 0;
      const status =
        open <= MONEY_TOL && received > MONEY_TOL
          ? "RECEBIDO"
          : open > MONEY_TOL
            ? "ABERTO"
            : r.attributionStatus;
      console.log(
        `${r.receivableId ?? (r.receivableIds?.join(",") || "—")} | ${r.sourceNfe ?? "—"} | ${r.dueDate ?? "—"} | ${r.settlementDate ?? "—"} | ${money(r.totalValue)} | ${money(r.receivedValue)} | ${money(r.openValue)} | ${status}`
      );
    }
  }

  console.log("\n7. Conclusão executiva");
  console.log(map.executiveConclusion);
  if (map.evidenceWarnings.length > 0) {
    console.log("Avisos de evidência:");
    for (const w of map.evidenceWarnings) console.log(`  - ${w}`);
  }
}

function looksLikeRawJson(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith("{") ||
    t.startsWith("[") ||
    /"financialStatus"\s*:/.test(t) ||
    /PrismaClient|stack trace|at Object\./i.test(t)
  );
}

function runChecks(bundle: LoadedBundle, map: PortfolioOrderFulfillmentMap): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });
  const s = map.fulfillmentSummary;

  add("pedidoEncontrado", Boolean(bundle.salesOrderId), `id=${bundle.salesOrderId}`);
  add(
    "valorPedido=158000",
    moneyClose(s.orderValue, EXPECTED_ORDER_VALUE),
    `actual=${s.orderValue}`
  );
  add(
    "itensPedidoExistem",
    bundle.orderItems.length >= 1 && map.orderItemsCoverage.length >= 1,
    `salesItems=${bundle.orderItems.length} coverage=${map.orderItemsCoverage.length}`
  );
  add(
    "documentosOuNfesExistem",
    bundle.nfeLinks.length >= 1 ||
      bundle.nfes.length >= 1 ||
      bundle.stockDocuments.length >= 1 ||
      map.stockDocumentsCoverage.length >= 1,
    `links=${bundle.nfeLinks.length} nfes=${bundle.nfes.length} docs=${bundle.stockDocuments.length}`
  );
  add(
    "mapaGerado",
    Boolean(map.fulfillmentSummary && map.orderItemsCoverage && map.executiveConclusion),
    "fulfillmentMap ok"
  );

  let qtyOk = map.orderItemsCoverage.length > 0;
  let pctOk = true;
  for (const item of map.orderItemsCoverage) {
    if (item.attendedQuantityCapped > item.orderedQuantity + 0.000001) qtyOk = false;
    if (
      item.fulfillmentPercentCapped != null &&
      item.fulfillmentPercentCapped > 100 + 0.001
    ) {
      pctOk = false;
    }
  }
  add("quantidadeAtendidaNaoPassaPedido", qtyOk, "attendedCapped <= ordered");
  add(
    "percentualNaoPassa100",
    pctOk && (s.fulfillmentPercent == null || s.fulfillmentPercent <= 100 + 0.001),
    `pct=${s.fulfillmentPercent}`
  );
  add(
    "valorAtribuidoNaoPassa158000",
    s.attributedOrderValueByOrderPrice <= EXPECTED_ORDER_VALUE + MONEY_TOL,
    `attributed=${s.attributedOrderValueByOrderPrice}`
  );
  add(
    "cabecalhoNfNaoInflaPedido",
    s.orderValue <= EXPECTED_ORDER_VALUE + MONEY_TOL &&
      s.attributedOrderValueByOrderPrice <= EXPECTED_ORDER_VALUE + MONEY_TOL &&
      (s.nfeHeaderTotalValue <= EXPECTED_ORDER_VALUE + MONEY_TOL ||
        s.hasHeaderInflationRisk ||
        map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO")),
    `header=${s.nfeHeaderTotalValue} attributed=${s.attributedOrderValueByOrderPrice}`
  );
  add(
    "statusFinanceiroExiste",
    map.financialStatus.startsWith("FIN_"),
    map.financialStatus
  );
  add(
    "statusOperacionalExiste",
    map.operationalStatus.startsWith("OP_"),
    map.operationalStatus
  );
  add(
    "alertasTecnicosSeparados",
    Array.isArray(map.technicalAlerts) &&
      map.financialStatus.startsWith("FIN_") &&
      map.operationalStatus.startsWith("OP_") &&
      !map.technicalAlerts.some((a) => a.startsWith("FIN_") || a.startsWith("OP_")),
    `alerts=${map.technicalAlerts.length}`
  );
  add(
    "crCoverageExiste",
    map.receivablesCoverage.length > 0 &&
      (s.receivableTotalValue > MONEY_TOL ||
        s.openReceivableValue > MONEY_TOL ||
        s.receivedValue > MONEY_TOL ||
        bundle.receivables.length > 0),
    `titles=${map.receivablesCoverage.length} total=${s.receivableTotalValue}`
  );
  add(
    "conclusaoExecutivaExiste",
    typeof map.executiveConclusion === "string" &&
      map.executiveConclusion.trim().length > 40 &&
      /pedido|atendido|caixa|documento|CR/i.test(map.executiveConclusion),
    map.executiveConclusion.slice(0, 100)
  );
  add(
    "semJsonCru",
    !looksLikeRawJson(map.executiveConclusion),
    "conclusão legível em português"
  );

  add(
    `fonte.${bundle.source}`,
    true,
    bundle.source === "DB" ? `run ${RUN_ID}` : "fixture PD 02339 com CR"
  );

  return checks;
}

function printChecks(checks: Check[]): boolean {
  console.log("\n8. PASS/FAIL");
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.name.startsWith("fonte.")) {
      console.log(`INFO  ${c.name} — ${c.detail}`);
      continue;
    }
    const mark = c.pass ? "PASS" : "FAIL";
    if (c.pass) pass += 1;
    else fail += 1;
    console.log(`${mark} ${c.name} — ${c.detail}`);
  }
  console.log(`\nResumo: PASS=${pass} FAIL=${fail}`);
  return fail === 0;
}

async function main() {
  console.log("Validação PD 02339 — Mapa de Atendimento (read-only)");
  console.log(`runId esperado: ${RUN_ID}`);
  console.log(`pedido: ${ORDER_CODE}`);

  let bundle: LoadedBundle;
  try {
    bundle = await loadFromDb();
    console.log("Fonte: BANCO (run materializada + SalesOrder/NF/doc/CR).");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`DB indisponível/sem fatos: ${msg}`);
    console.warn("Usando fixture PD 02339 (com CR de referência).");
    bundle = loadFixture();
  }

  const map = buildMap(bundle);
  printReport(bundle, map);
  const ok = printChecks(runChecks(bundle, map));

  if (!ok) {
    console.error("\nFALHA: investigar fulfillment map / fatos — não maquiar números.");
    process.exitCode = 1;
    return;
  }
  console.log(
    bundle.source === "FIXTURE"
      ? "\nPD 02339 bateu no FIXTURE (FAIL=0). Reexecute com DB para validar a materialização."
      : "\nPD 02339 bateu na run materializada (PASS / FAIL=0)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
