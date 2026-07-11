/**
 * Validação real — Mapa de Atendimento PD 02339 (Britânia).
 *
 * Uso:
 *   npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
 *
 * Preferência: run materializada no banco
 *   runId = 1dc2ead7-533d-4ad4-bc4c-621061fa5623
 *
 * Fallback: fixture de alocação (mesmos produtos/NFs) se DB indisponível.
 * Read-only — não grava nada. Não altera regras oficiais.
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
  orderValue: number;
  paymentTermsAvailable: boolean;
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
    customerNameSnapshot: "Britania",
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
  return {
    source: "FIXTURE",
    salesOrderId: order.id,
    orderCode: ORDER_CODE,
    orderValue: EXPECTED_ORDER_VALUE,
    paymentTermsAvailable: false,
    facts: built.facts.map((d, i) => portfolioFactDraftToApiRow(d, `fixture-${i}`)),
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
      where: { orderCode: ORDER_CODE },
      select: {
        id: true,
        orderCode: true,
        totalNetValue: true,
        paymentTerms: true,
        paymentMethod: true,
        externalSalesOrderId: true,
        issueDate: true,
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

    const orderValue =
      decimalToNumber(order.totalNetValue) ?? EXPECTED_ORDER_VALUE;

    return {
      source: "DB",
      salesOrderId: order.id,
      orderCode: order.orderCode,
      orderValue,
      paymentTermsAvailable: Boolean(
        order.paymentTerms?.trim() || order.paymentMethod?.trim()
      ),
      facts: factsRaw.map((r) => mapFact(r as unknown as Record<string, unknown>)),
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
    },
    orderItems: bundle.orderItems,
    reconciliationFacts: bundle.facts,
    nfeLinks: bundle.nfeLinks,
    nfes: bundle.nfes,
    stockDocuments: bundle.stockDocuments,
    orderValue: bundle.orderValue,
    paymentTermsAvailable: bundle.paymentTermsAvailable,
    runId: RUN_ID,
  });
}

function printReport(bundle: LoadedBundle, map: PortfolioOrderFulfillmentMap) {
  const s = map.fulfillmentSummary;
  console.log("\n--- Resumo do pedido ---");
  console.log(`Pedido: ${bundle.orderCode} (${bundle.salesOrderId})`);
  console.log(`Fonte: ${bundle.source}${bundle.source === "DB" ? ` · run ${RUN_ID}` : ""}`);
  console.log(`Valor do pedido: ${money(s.orderValue)}`);
  console.log(`Fatos: ${bundle.facts.length}`);
  console.log(`Itens SalesOrder: ${bundle.orderItems.length}`);
  console.log(`Links NF: ${bundle.nfeLinks.length}`);
  console.log(`NFs: ${bundle.nfes.length}`);
  console.log(`Docs saída: ${bundle.stockDocuments.length}`);

  console.log("\n--- Status ---");
  console.log(
    `Financeiro: ${map.financialStatus} (${FINANCIAL_STATUS_LABEL[map.financialStatus]})`
  );
  console.log(
    `Operacional: ${map.operationalStatus} (${OPERATIONAL_STATUS_LABEL[map.operationalStatus]})`
  );
  console.log(
    `Alertas técnicos: ${
      map.technicalAlerts.length === 0
        ? "(nenhum)"
        : map.technicalAlerts
            .map((a) => `${a} (${TECHNICAL_ALERT_LABEL[a] ?? a})`)
            .join("; ")
    }`
  );

  console.log("\n--- Resumo de atendimento ---");
  console.log(`Qtde pedida: ${qty(s.totalOrderedQuantity)}`);
  console.log(`Qtde atendida (capped): ${qty(s.totalAttendedQuantityCapped)}`);
  console.log(`Qtde restante: ${qty(s.totalRemainingQuantity)}`);
  console.log(`Qtde excedente: ${qty(s.totalExcessQuantity)}`);
  console.log(`% atendimento: ${s.fulfillmentPercent ?? "—"}%`);
  console.log(`Valor atribuído (preço pedido): ${money(s.attributedOrderValueByOrderPrice)}`);
  console.log(`Cabeçalho NF total: ${money(s.nfeHeaderTotalValue)}`);
  console.log(`Cabeçalho não atribuído: ${money(s.nfeHeaderNotAttributedToOrderValue)}`);
  console.log(`CR total: ${money(s.receivableTotalValue)}`);
  console.log(`Recebido: ${money(s.receivedValue)}`);
  console.log(`Aberto: ${money(s.openReceivableValue)}`);
  console.log(`Risco cabeçalho: ${s.hasHeaderInflationRisk ? "SIM" : "não"}`);
  console.log(`Produto fora: ${s.hasProductsOutsideOrder ? "SIM" : "não"}`);
  console.log(`Excesso qtde: ${s.hasExcessQuantity ? "SIM" : "não"}`);

  console.log("\n--- Conclusão executiva ---");
  console.log(map.executiveConclusion);
  if (map.evidenceWarnings.length > 0) {
    console.log("Avisos:");
    for (const w of map.evidenceWarnings) console.log(`  - ${w}`);
  }

  console.log("\n--- Itens do pedido ---");
  console.log(
    "produto | pedida | atendida | saldo | excesso | % | valor item | docs"
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
      `${row.productCode ?? row.externalProductId ?? "?"} | ${qty(row.orderedQuantity)} | ${qty(row.attendedQuantityCapped)} | ${qty(row.remainingQuantity)} | ${qty(row.excessQuantityForThisProduct)} | ${row.fulfillmentPercentCapped ?? "—"}% | ${money(row.orderItemValue)} | ${docs}`
    );
  }

  console.log("\n--- Documentos / NFs ---");
  console.log(
    "NF | doc | cabeçalho | atribuído | fora | casados | excedentes | fora_pedido"
  );
  for (const doc of map.stockDocumentsCoverage) {
    const matched = doc.matchedItems
      .map((m) => `${m.productExternalId}(${qty(m.allocatedQuantity)})`)
      .join(",") || "—";
    const surplus = doc.surplusItems
      .map((m) => `${m.productExternalId}(${qty(m.stockQuantity)})`)
      .join(",") || "—";
    const outside = (doc.itemsOutsideOrder ?? doc.unmatchedItems)
      .map((m) => `${m.productExternalId}(${qty(m.stockQuantity)})`)
      .join(",") || "—";
    console.log(
      `${doc.nfeNumber ?? doc.nfeExternalId ?? "—"} | ${doc.stockDocumentExternalId ?? "—"} | ${money(doc.nfeHeaderValue)} | ${money(doc.valueAttributedToOrder)} | ${money(doc.valueNotAttributedToOrder)} | ${matched} | ${surplus} | ${outside}`
    );
  }

  console.log("\n--- Itens fora / excedentes (agregado) ---");
  let anyExtra = false;
  for (const doc of map.stockDocumentsCoverage) {
    for (const x of doc.surplusItems) {
      anyExtra = true;
      console.log(
        `EXCEDENTE NF ${doc.nfeNumber ?? doc.nfeExternalId} doc ${doc.stockDocumentExternalId}: produto ${x.productExternalId} qtde ${qty(x.stockQuantity)} valor ${money(x.stockItemValue)}`
      );
    }
    for (const x of doc.itemsOutsideOrder ?? doc.unmatchedItems) {
      anyExtra = true;
      console.log(
        `FORA_PEDIDO NF ${doc.nfeNumber ?? doc.nfeExternalId} doc ${doc.stockDocumentExternalId}: produto ${x.productExternalId} qtde ${qty(x.stockQuantity)}`
      );
    }
  }
  if (!anyExtra) console.log("(nenhum)");

  console.log("\n--- Contas a Receber ---");
  if (map.receivablesCoverage.length === 0) {
    console.log("(nenhum título vinculado nesta materialização)");
  } else {
    console.log("id | vencimento | baixa | total | recebido | aberto | fonte | atribuição");
    for (const r of map.receivablesCoverage) {
      console.log(
        `${r.receivableId ?? (r.receivableIds?.join(",") || "—")} | ${r.dueDate ?? "—"} | ${r.settlementDate ?? "—"} | ${money(r.totalValue)} | ${money(r.receivedValue)} | ${money(r.openValue)} | ${r.sourceNfe ?? "—"} | ${r.attributionStatus}`
      );
    }
  }
}

function runChecks(
  bundle: LoadedBundle,
  map: PortfolioOrderFulfillmentMap
): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });
  const s = map.fulfillmentSummary;

  add("pedido.encontrado", Boolean(bundle.salesOrderId), `id=${bundle.salesOrderId}`);
  add("pedido.codigo", bundle.orderCode === ORDER_CODE, `code=${bundle.orderCode}`);
  add(
    "valor.pedido=158000",
    moneyClose(s.orderValue, EXPECTED_ORDER_VALUE),
    `actual=${s.orderValue}`
  );
  add(
    "mapa.atendimento.existe",
    Boolean(map.orderItemsCoverage && map.fulfillmentSummary && map.executiveConclusion),
    "fulfillmentMap ok"
  );
  add(
    "itens.individuais.visiveis",
    map.orderItemsCoverage.length >= 1,
    `items=${map.orderItemsCoverage.length}`
  );
  add(
    "docs.nfs.vinculados",
    map.stockDocumentsCoverage.length >= 1 || bundle.nfeLinks.length >= 1,
    `docs=${map.stockDocumentsCoverage.length} links=${bundle.nfeLinks.length}`
  );

  let qtyOk = map.orderItemsCoverage.length > 0;
  let pctOk = true;
  for (const item of map.orderItemsCoverage) {
    const attended = item.attendedQuantityCapped;
    if (attended > item.orderedQuantity + 0.000001) qtyOk = false;
    if (
      item.fulfillmentPercentCapped != null &&
      item.fulfillmentPercentCapped > 100 + 0.001
    ) {
      pctOk = false;
    }
  }
  add("qtde.atendida.nunca.ultrapassa.pedida", qtyOk, "capped <= ordered");
  add("percentual.item.nunca.passa.100", pctOk, "fulfillmentPercentCapped <= 100");

  if (s.hasExcessQuantity) {
    add(
      "excesso.aparece.excessQuantity",
      s.totalExcessQuantity > 0.000001,
      `totalExcess=${s.totalExcessQuantity}`
    );
  } else {
    add("excesso.ausente.ou.zero", s.totalExcessQuantity <= 0.000001, "sem excesso");
  }

  if (s.hasProductsOutsideOrder) {
    const outsideCount = map.stockDocumentsCoverage.reduce(
      (n, d) => n + (d.itemsOutsideOrder?.length ?? d.unmatchedItems.length),
      0
    );
    add(
      "produto.fora.aparece.itemsOutsideOrder",
      outsideCount > 0,
      `outsideRows=${outsideCount}`
    );
  } else {
    add("produto.fora.ausente", true, "sem produto fora nesta evidência");
  }

  add(
    "cabecalho.nao.e.valor.pedido",
    !moneyClose(s.nfeHeaderTotalValue, s.orderValue) || s.nfeHeaderTotalValue <= 0,
    `header=${s.nfeHeaderTotalValue} order=${s.orderValue}`
  );
  add(
    "cabecalho.nao.infla.pedido",
    s.attributedOrderValueByOrderPrice <= EXPECTED_ORDER_VALUE + MONEY_TOL &&
      s.orderValue <= EXPECTED_ORDER_VALUE + MONEY_TOL,
    `attributed=${s.attributedOrderValueByOrderPrice} order=${s.orderValue}`
  );
  add(
    "sem.duplicidade.valor.atribuido",
    s.attributedOrderValueByOrderPrice <= s.orderValue + MONEY_TOL,
    `attributed=${s.attributedOrderValueByOrderPrice}`
  );

  if (s.hasHeaderInflationRisk || s.nfeHeaderTotalValue > s.orderValue + MONEY_TOL) {
    add(
      "alerta.NF_CABECALHO_MAIOR_PEDIDO",
      map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"),
      `alerts=${map.technicalAlerts.join(",")}`
    );
  } else {
    add("alerta.cabecalho.nao.aplicavel", true, "sem inflação de cabeçalho");
  }

  const hasPriceMismatchEvidence =
    bundle.facts.some((f) => f.status === "PRICE_MISMATCH") ||
    map.technicalAlerts.includes("DIVERGENCIA_PRECO");
  if (hasPriceMismatchEvidence) {
    add(
      "alerta.DIVERGENCIA_PRECO",
      map.technicalAlerts.includes("DIVERGENCIA_PRECO"),
      "price mismatch evidenciado"
    );
  } else {
    add("alerta.preco.nao.aplicavel", true, "sem divergência de preço nesta evidência");
  }

  if (s.receivableTotalValue > MONEY_TOL || s.receivedValue > MONEY_TOL) {
    add(
      "cr.em.receivablesCoverage",
      map.receivablesCoverage.length > 0,
      `titles=${map.receivablesCoverage.length} total=${s.receivableTotalValue}`
    );
  } else {
    add(
      "cr.ausente.nesta.materializacao",
      true,
      bundle.source === "DB"
        ? "sem CR nos fatos — financeiro sem inventar título"
        : "fixture sem CR"
    );
  }

  add(
    "eixos.separados",
    map.financialStatus.startsWith("FIN_") && map.operationalStatus.startsWith("OP_"),
    `fin=${map.financialStatus} op=${map.operationalStatus}`
  );
  add(
    "conclusao.executiva.pt",
    /Financeiro:|Atendimento:|Alertas técnicos/i.test(map.executiveConclusion) &&
      map.executiveConclusion.length > 40,
    map.executiveConclusion.slice(0, 120)
  );
  add(
    "atendimento.item.a.item.visivel",
    map.orderItemsCoverage.every(
      (r) =>
        typeof r.orderedQuantity === "number" &&
        typeof r.attendedQuantityCapped === "number" &&
        typeof r.remainingQuantity === "number"
    ),
    "itens com pedida/atendida/saldo"
  );

  add(
    `fonte.${bundle.source}`,
    true,
    bundle.source === "DB" ? `run ${RUN_ID}` : "fixture PD 02339"
  );

  return checks;
}

function printChecks(checks: Check[]): boolean {
  console.log("\n=== PASS/FAIL PD 02339 fulfillment map ===");
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.name.startsWith("fonte.")) {
      console.log(`INFO  ${c.name}: ${c.detail}`);
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

function interpret(map: PortfolioOrderFulfillmentMap): void {
  console.log("\n--- Interpretação ---");
  const op = map.operationalStatus;
  if (op === "OP_TOTALMENTE_ATENDIDO") {
    console.log("Atendimento: TOTALMENTE atendido (itens 100%, sem excedente no status).");
  } else if (op === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE") {
    console.log(
      "Atendimento: TOTALMENTE atendido COM EXCEDENTE (itens 100% + qtde/doc acima do pedido)."
    );
  } else if (op === "OP_PARCIALMENTE_ATENDIDO") {
    console.log("Atendimento: PARCIAL (ainda há saldo a atender).");
  } else {
    console.log(`Atendimento: ${op}`);
  }
  console.log(
    `Excedente: ${
      map.fulfillmentSummary.hasExcessQuantity
        ? `SIM (${qty(map.fulfillmentSummary.totalExcessQuantity)})`
        : "não"
    }`
  );
  console.log(
    `Item fora do pedido: ${
      map.fulfillmentSummary.hasProductsOutsideOrder ? "SIM" : "não"
    }`
  );
  console.log(
    `CR: ${
      map.fulfillmentSummary.receivableTotalValue > MONEY_TOL
        ? `vinculado — total ${money(map.fulfillmentSummary.receivableTotalValue)}, recebido ${money(map.fulfillmentSummary.receivedValue)}, aberto ${money(map.fulfillmentSummary.openReceivableValue)}`
        : "não aparece nesta materialização (não inventado)"
    }`
  );
}

async function main() {
  console.log("=== Validação PD 02339 — Mapa de atendimento (run real) ===");
  console.log(`runId esperado: ${RUN_ID}`);
  console.log(`pedido: ${ORDER_CODE}`);

  let bundle: LoadedBundle;
  try {
    bundle = await loadFromDb();
    console.log("Fonte: BANCO (run materializada + SalesOrder/NF/doc).");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`DB indisponível/sem fatos: ${msg}`);
    console.warn("Usando fixture PD 02339 (alocação preview).");
    bundle = loadFixture();
  }

  const map = buildMap(bundle);
  printReport(bundle, map);
  interpret(map);
  const ok = printChecks(runChecks(bundle, map));

  if (!ok) {
    console.error("\nFALHA: investigar fulfillment map / fatos — não maquiar números.");
    process.exitCode = 1;
    return;
  }
  console.log(
    bundle.source === "FIXTURE"
      ? "\nPD 02339 bateu no FIXTURE. Reexecute com DB para validar a materialização."
      : "\nPD 02339 bateu na run materializada (PASS)."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
