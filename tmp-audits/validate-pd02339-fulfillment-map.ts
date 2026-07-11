/**
 * Validação do mapa de atendimento — PD 02339 (Britânia).
 *
 * Uso:
 *   npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
 *
 * Preferência: run materializada no banco.
 * Fallback: snapshot de alocação PD 02339 (mesmos produtos/NFs do fixture).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildPortfolioReconciliationFacts } from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import type {
  PortfolioReconciliationSnapshot,
  SnapshotOrder,
} from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import { buildPortfolioOrderFulfillmentMap } from "../src/lib/finance/portfolioOrderFulfillmentMap.ts";
import type { PortfolioReconciliationFactApiRow } from "../src/lib/finance/portfolioReconciliationApi.ts";

const ORDER_CODE = "PD 02339";
const EXPECTED_ORDER_VALUE = 158_000;
const MONEY_TOL = 0.05;

type Check = { name: string; pass: boolean; detail: string };

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

function draftsToApi(
  drafts: ReturnType<typeof buildPortfolioReconciliationFacts>["facts"]
): PortfolioReconciliationFactApiRow[] {
  return drafts.map((d, i) => ({
    id: `f-${i}`,
    runId: d.runId,
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: d.customerNameSnapshot,
    salesOrderId: d.salesOrderId,
    externalSalesOrderId: d.externalSalesOrderId,
    orderCode: d.orderCode,
    orderIssueDate: d.orderIssueDate,
    expectedDeliveryDate: null,
    salesOrderItemId: d.salesOrderItemId,
    externalSalesOrderItemId: null,
    externalProductId: d.externalProductId,
    productSkuSnapshot: d.productSkuSnapshot,
    productNameSnapshot: d.productNameSnapshot,
    orderQuantity: d.orderQuantity,
    orderUnitPrice: d.orderUnitPrice,
    orderItemValue: d.orderItemValue,
    nomusNfeId: d.nomusNfeId,
    nfeExternalId: d.nfeExternalId,
    nfeNumber: d.nfeNumber,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: d.nfeProcessedAt,
    nfeHeaderValue: d.nfeHeaderValue,
    stockDocumentId: d.stockDocumentId,
    stockDocumentExternalId: d.stockDocumentExternalId,
    stockDocumentItemId: d.stockDocumentItemId,
    stockDocumentItemExternalId: null,
    stockDocumentDate: d.stockDocumentDate,
    stockQuantity: d.stockQuantity,
    stockUnitValue: d.stockUnitValue,
    stockItemValue: d.stockItemValue,
    allocatedQuantity: d.allocatedQuantity,
    allocatedValueByOrderPrice: d.allocatedValueByOrderPrice,
    allocatedValueByStockPrice: d.allocatedValueByStockPrice,
    remainingOrderQuantityAfterAllocation: d.remainingOrderQuantityAfterAllocation,
    remainingOrderValueAfterAllocation: d.remainingOrderValueAfterAllocation,
    priceDifferenceUnit: d.priceDifferenceUnit,
    priceDifferenceTotal: d.priceDifferenceTotal,
    receivableIdsJson: d.receivableIdsJson,
    receivableTotalValue: d.receivableTotalValue,
    receivedValue: d.receivedValue,
    openReceivableValue: d.openReceivableValue,
    dueDatesJson: d.dueDatesJson,
    settlementDatesJson: d.settlementDatesJson,
    forecastSource: d.forecastSource ?? "UNRESOLVED",
    forecastDate: d.forecastDate,
    forecastValue: d.forecastValue,
    confidenceLevel: d.confidenceLevel,
    status: d.status,
    alertsJson: d.alertsJson,
    traceJson: d.traceJson,
  }));
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

async function loadFromDb(): Promise<{
  facts: PortfolioReconciliationFactApiRow[];
  orderValue: number;
  source: "DB";
}> {
  const prisma = new PrismaClient();
  try {
    const order = await prisma.salesOrder.findFirst({
      where: { orderCode: ORDER_CODE },
      select: { id: true, totalNetValue: true },
    });
    if (!order) throw new Error(`Pedido ${ORDER_CODE} não encontrado.`);

    const fact = await prisma.portfolioReconciliationFact.findFirst({
      where: { salesOrderId: order.id },
      orderBy: { runId: "desc" },
      select: { runId: true },
    });
    if (!fact) throw new Error(`Sem fatos de conciliação para ${ORDER_CODE}.`);

    const raw = await prisma.portfolioReconciliationFact.findMany({
      where: { runId: fact.runId, salesOrderId: order.id },
    });
    const orderValue =
      decimalToNumber(order.totalNetValue) ?? EXPECTED_ORDER_VALUE;
    return {
      facts: raw.map((r) => mapFact(r as unknown as Record<string, unknown>)),
      orderValue,
      source: "DB",
    };
  } finally {
    await prisma.$disconnect();
  }
}

function loadFixture(): {
  facts: PortfolioReconciliationFactApiRow[];
  orderValue: number;
  source: "FIXTURE";
} {
  const built = buildPortfolioReconciliationFacts({
    runId: "fixture-pd02339",
    mode: "preview",
    snapshot: pd02339Snapshot(),
  });
  return {
    facts: draftsToApi(built.facts),
    orderValue: EXPECTED_ORDER_VALUE,
    source: "FIXTURE",
  };
}

function runChecks(
  facts: PortfolioReconciliationFactApiRow[],
  orderValue: number,
  source: string
): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  add("pedido.encontrado", facts.length > 0, `facts=${facts.length}`);
  add(
    "pedido.codigo",
    facts.some((f) => f.orderCode === ORDER_CODE),
    `orderCode=${facts[0]?.orderCode}`
  );

  const map = buildPortfolioOrderFulfillmentMap({
    facts,
    orderValue,
    paymentTermsAvailable: false,
  });

  add(
    "valor.pedido=158000",
    moneyClose(map.fulfillmentSummary.orderValue, EXPECTED_ORDER_VALUE),
    `actual=${map.fulfillmentSummary.orderValue}`
  );
  add(
    "cabecalho.NF.nao.e.valor.pedido",
    map.fulfillmentSummary.nfeHeaderTotal > EXPECTED_ORDER_VALUE + MONEY_TOL &&
      !moneyClose(map.fulfillmentSummary.nfeHeaderTotal, map.fulfillmentSummary.orderValue),
    `header=${map.fulfillmentSummary.nfeHeaderTotal} order=${map.fulfillmentSummary.orderValue}`
  );
  add(
    "docs.vinculados.listados",
    map.stockDocumentsCoverage.length >= 1,
    `docs=${map.stockDocumentsCoverage.length}`
  );
  add(
    "itens.individuais",
    map.orderItemsCoverage.length >= 4,
    `items=${map.orderItemsCoverage.length}`
  );

  let itemsOk = map.orderItemsCoverage.length > 0;
  for (const item of map.orderItemsCoverage) {
    if (
      !(item.orderedQuantity >= 0) ||
      !(item.attendedQuantity >= 0) ||
      !(item.remainingQuantity >= 0)
    ) {
      itemsOk = false;
      break;
    }
  }
  add("itens.qtde.pedida.atendida.saldo", itemsOk, "ok");

  add(
    "financeiro.separado",
    Boolean(map.financialStatus?.startsWith("FIN_")),
    `financial=${map.financialStatus}`
  );
  add(
    "operacional.separado",
    Boolean(map.operationalStatus?.startsWith("OP_")),
    `operational=${map.operationalStatus}`
  );
  add(
    "alertas.tecnicos.separados",
    map.technicalAlerts.length >= 1 &&
      map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"),
    `alerts=${map.technicalAlerts.join(",")}`
  );
  add(
    "operacional.totalmente.atendido.quando.itens.completos",
    map.operationalStatus === "OP_TOTALMENTE_ATENDIDO" ||
      map.fulfillmentSummary.remainingQuantity > 0,
    `op=${map.operationalStatus} remaining=${map.fulfillmentSummary.remainingQuantity}`
  );

  // CR: se materializado, aparece; fixture sem CR é aceitável
  if (map.fulfillmentSummary.receivableTotal > 0) {
    add(
      "cr.vinculado",
      map.receivablesCoverage.length > 0,
      `titles=${map.receivablesCoverage.length} received=${map.fulfillmentSummary.receivedValue} open=${map.fulfillmentSummary.openReceivableValue}`
    );
  } else {
    add(
      "cr.ausente.fixture.ou.sem.titulo",
      true,
      source === "DB"
        ? "sem CR na materialização atual"
        : "fixture sem CR — financeiro FIN_FATURADO_SEM_CR esperado"
    );
  }

  add(`fonte.${source}`, true, source === "DB" ? "run materializada" : "fixture PD 02339");
  return checks;
}

function printChecks(checks: Check[]) {
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

async function main() {
  console.log("=== Validação PD 02339 — Mapa de atendimento ===");
  let facts: PortfolioReconciliationFactApiRow[];
  let orderValue: number;
  let source: "DB" | "FIXTURE";

  try {
    const loaded = await loadFromDb();
    facts = loaded.facts;
    orderValue = loaded.orderValue;
    source = loaded.source;
    console.log("Fonte: banco.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`DB indisponível/sem fatos: ${msg}`);
    console.warn("Usando fixture PD 02339 (alocação preview).");
    const loaded = loadFixture();
    facts = loaded.facts;
    orderValue = loaded.orderValue;
    source = loaded.source;
  }

  const ok = printChecks(runChecks(facts, orderValue, source));
  if (!ok) {
    console.error("\nFALHA: investigar fulfillment map / fatos — não maquiar números.");
    process.exitCode = 1;
    return;
  }
  console.log(
    source === "FIXTURE"
      ? "\nPD 02339 bateu no FIXTURE. Reexecute com DB para validar a materialização."
      : "\nPD 02339 bateu na run materializada."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
