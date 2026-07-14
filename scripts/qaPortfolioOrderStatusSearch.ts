/**
 * QA — Busca inteligente (Status Pedidos).
 *
 * Uso: npx tsx scripts/qaPortfolioOrderStatusSearch.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPortfolioOrderStatusListFromFacts,
  parsePortfolioOrderStatusFilters,
  type PortfolioOrderStatusRunMeta,
} from "../src/lib/finance/portfolioOrderStatusApi.js";
import type { PortfolioOrderStatusFact } from "../src/lib/finance/portfolioOrderStatusService.js";
import {
  matchOrderStatusSearch,
  normalizeOrderStatusSearch,
} from "../src/lib/finance/portfolioOrderStatusSearch.js";

const root = process.cwd();
let failed = 0;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}

function ok(id: string, msg: string) {
  console.log(`OK   ${id} — ${msg}`);
}

function fail(id: string, msg: string) {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

function fact(
  partial: Partial<PortfolioOrderStatusFact> & { id: string }
): PortfolioOrderStatusFact {
  return {
    runId: "run-search-qa",
    orderCode: "PD X",
    orderIssueDate: new Date(2026, 0, 15),
    orderExpectedDeliveryDate: new Date(2026, 1, 15),
    orderNetValue: 10_000,
    customerId: "cust",
    customerName: "Cliente",
    externalCustomerId: 100,
    sellerName: "Vendedor",
    sellerQualityStatus: "OK",
    productCode: "SKU1",
    sku: "SKU1",
    productName: "Produto",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 100,
    orderItemTotalValue: 1000,
    stockDocumentId: "doc-1",
    stockDocumentExternalId: 8457,
    stockDocumentDate: new Date(2026, 0, 20),
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 1000,
    allocatedValueByDocumentPrice: 1000,
    stockDocumentItemUnitValue: 100,
    stockDocumentItemTotalValue: 1000,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeNumber: "7135",
    nfeIssueDate: new Date(2026, 0, 21),
    nfeHeaderValue: 1000,
    receivableTotalValue: 1000,
    receivableOpenValue: 1000,
    receivableReceivedValue: 0,
    paymentDueDate: new Date(2026, 2, 1),
    paymentSettlementDate: null,
    paymentStatus: "OPEN",
    operationalStage: "FULLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "CR_ABERTO",
    temperature: "AMARELO",
    confidenceScore: 0.8,
    confidenceLabel: "ALTA",
    responsibleArea: "Financeiro",
    recommendedAction: "Acompanhar",
    alertsJson: [],
    blockingReasonsJson: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPaymentConditionMissing: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasReceivableWithoutSafeLink: false,
    hasPaymentDateDivergence: false,
    hasRecentPaymentNotReflected: false,
    salesOrderId: "order-x",
    commercialResponsibleName: null,
    ...partial,
  } as PortfolioOrderStatusFact;
}

const RUN: PortfolioOrderStatusRunMeta = {
  runId: "run-search-qa",
  createdAt: "2026-07-14T00:00:00.000Z",
  periodFrom: "2026-01-01",
  periodTo: "2026-12-31",
  dataSource: "order_to_cash_audit",
  status: "SUCCESS",
  finishedAt: "2026-07-14T00:00:00.000Z",
  isGeneralRun: true,
  year: 2026,
  totalOrders: 2,
  totalFacts: 3,
};

function fixtureFacts(): PortfolioOrderStatusFact[] {
  return [
    fact({
      id: "f1",
      salesOrderId: "order-pd-02586",
      orderCode: "PD 02586",
      customerName: "Britânia Eletrodomésticos",
      externalCustomerId: 900,
      nfeNumber: "7135",
      stockDocumentExternalId: 8457,
      orderNetValue: 50_000,
    }),
    fact({
      id: "f2",
      salesOrderId: "order-pd-02586",
      orderCode: "PD 02586",
      customerName: "Britânia Eletrodomésticos",
      externalCustomerId: 900,
      nfeNumber: "7142",
      stockDocumentExternalId: 8458,
      orderNetValue: 50_000,
      productCode: "SKU2",
      sku: "SKU2",
    }),
    fact({
      id: "f3",
      salesOrderId: "order-other",
      orderCode: "PD 09999",
      customerName: "Outro Cliente",
      externalCustomerId: 901,
      nfeNumber: "9999",
      stockDocumentExternalId: 9999,
      orderNetValue: 1_000,
    }),
  ];
}

function searchPayload(search: string, year = 2026) {
  const filters = parsePortfolioOrderStatusFilters({ year, search, pageSize: 50 });
  return buildPortfolioOrderStatusListFromFacts({
    facts: fixtureFacts(),
    filters,
    runMeta: RUN,
  });
}

function checkFiles() {
  for (const rel of [
    "src/lib/finance/portfolioOrderStatusSearch.ts",
    "tmp-audits/inspect-portfolio-order-status-search.ts",
    "tmp-audits/inspect-pd02586-links.ts",
    "docs/finance/portfolio-order-status-tab.md",
  ]) {
    if (exists(rel)) ok(`files:${rel}`, "presente");
    else fail(`files:${rel}`, "ausente");
  }
}

function checkNormalize() {
  const pd = normalizeOrderStatusSearch("PD 02586");
  if (pd?.digits === "02586" && pd.kindHint === "SALES_ORDER") {
    ok("norm:pd", "PD 02586 → digits 02586 / SALES_ORDER");
  } else fail("norm:pd", JSON.stringify(pd));

  const nf = normalizeOrderStatusSearch("NF 7135");
  if (nf?.digits === "7135" && nf.kindHint === "NFE") {
    ok("norm:nf", "NF 7135 → digits 7135 / NFE");
  } else fail("norm:nf", JSON.stringify(nf));

  const doc = normalizeOrderStatusSearch("DOC 8457");
  if (doc?.asNumber === 8457 && doc.kindHint === "STOCK_DOCUMENT") {
    ok("norm:doc", "DOC 8457 → 8457 / STOCK_DOCUMENT");
  } else fail("norm:doc", JSON.stringify(doc));

  const short = normalizeOrderStatusSearch("12");
  if (short && !short.usable) ok("norm:short", "termo curto não é usable");
  else fail("norm:short", JSON.stringify(short));
}

function checkMatchHelpers() {
  const row = {
    orderCode: "PD 02586",
    customerName: "Britânia Eletrodomésticos",
    externalCustomerId: 900,
    nfeNumbers: ["7135", "7142"],
    stockDocumentExternalIds: [8457, 8458],
    productTokens: ["sku1", "sku2"],
  };
  const byOrder = matchOrderStatusSearch(row, normalizeOrderStatusSearch("02586")!);
  if (byOrder?.matchedBy === "SALES_ORDER") ok("match:order", "02586 → pedido");
  else fail("match:order", JSON.stringify(byOrder));

  const byNfe = matchOrderStatusSearch(row, normalizeOrderStatusSearch("7135")!);
  if (byNfe?.matchedBy === "NFE") ok("match:nfe", "7135 → NF");
  else fail("match:nfe", JSON.stringify(byNfe));

  const byDoc = matchOrderStatusSearch(row, normalizeOrderStatusSearch("DOC 8457")!);
  if (byDoc?.matchedBy === "STOCK_DOCUMENT") ok("match:doc", "DOC 8457 → documento");
  else fail("match:doc", JSON.stringify(byDoc));

  const byCust = matchOrderStatusSearch(row, normalizeOrderStatusSearch("Britania")!);
  if (byCust?.matchedBy === "CUSTOMER") ok("match:customer", "Britania → cliente");
  else fail("match:customer", JSON.stringify(byCust));
}

function checkListFromFacts() {
  const cases: Array<[string, string, number]> = [
    ["PD 02586", "PD 02586", 1],
    ["02586", "PD 02586", 1],
    ["7135", "PD 02586", 1],
    ["7142", "PD 02586", 1],
    ["8457", "PD 02586", 1],
    ["Britania", "PD 02586", 1],
  ];
  for (const [search, order, count] of cases) {
    const payload = searchPayload(search);
    const codes = payload.rows.map((r) => r.orderCode);
    if (payload.rows.length === count && codes.includes(order)) {
      ok(`list:${search}`, `retorna ${order} (n=${payload.rows.length})`);
    } else {
      fail(`list:${search}`, `esperado ${order}×${count}, veio ${JSON.stringify(codes)}`);
    }
  }

  // 7135 e 7142 no mesmo pedido → uma linha
  const both = searchPayload("7135");
  if (both.rows.length === 1 && both.rows[0]?.nfeNumbers.includes("7142")) {
    ok("list:one-row", "uma linha por pedido mesmo com 2 NFs");
  } else {
    fail("list:one-row", JSON.stringify(both.rows.map((r) => r.nfeNumbers)));
  }

  const empty = searchPayload("ZZZ_INEXISTENTE_999");
  if (empty.rows.length === 0 && empty.state !== "NO_RUN") {
    ok("list:empty", "termo inexistente → lista vazia sem erro");
  } else {
    fail("list:empty", `state=${empty.state} rows=${empty.rows.length}`);
  }

  // Combina com ano
  const wrongYear = searchPayload("PD 02586", 2024);
  if (wrongYear.rows.length === 0) {
    ok("list:year", "busca + ano 2024 não retorna pedido 2026");
  } else {
    fail("list:year", `veio ${wrongYear.rows.length} linha(s)`);
  }

  const matched = searchPayload("NF 7135");
  if (matched.rows[0]?.searchMatchedBy === "NFE") {
    ok("list:matchedBy", `matchedBy=NFE / ${matched.rows[0]?.searchMatchedText}`);
  } else {
    fail("list:matchedBy", JSON.stringify(matched.rows[0]?.searchMatchedBy));
  }
}

function checkFrontendWiring() {
  const filtersUi = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusFilters.tsx"
  );
  const client = read("src/lib/finance/portfolioOrderStatusClient.ts");
  const api = read("src/lib/finance/portfolioOrderStatusApi.ts");
  const dlg = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTable.tsx"
  );

  if (filtersUi.includes("Busca inteligente") && filtersUi.includes("order-status-search")) {
    ok("ui:field", "campo Busca inteligente presente");
  } else fail("ui:field", "campo ausente na UI");

  if (client.includes('params.set("search"') && client.includes("search:")) {
    ok("client:search", "client envia parâmetro search");
  } else fail("client:search", "client sem search");

  if (api.includes("search: asString(query.search)") || api.includes('asString(query.search)')) {
    ok("api:search", "API parseia search");
  } else fail("api:search", "API sem search");

  if (dlg.includes("searchMatchedText")) {
    ok("ui:match-chip", "tabela exibe match da busca");
  } else fail("ui:match-chip", "tabela sem chip de match");

  if (/@prisma\/client/.test(filtersUi) || /@prisma\/client/.test(dlg)) {
    fail("frontend:no-prisma", "frontend importa Prisma");
  } else {
    ok("frontend:no-prisma", "frontend sem Prisma");
  }
}

function checkDocs() {
  const doc = read("docs/finance/portfolio-order-status-tab.md");
  if (doc.includes("Busca inteligente")) ok("docs:section", "seção documentada");
  else fail("docs:section", "docs sem Busca inteligente");
}

function main() {
  console.log("=== qaPortfolioOrderStatusSearch ===\n");
  checkFiles();
  checkNormalize();
  checkMatchHelpers();
  checkListFromFacts();
  checkFrontendWiring();
  checkDocs();

  console.log("");
  if (failed === 0) {
    console.log("✔ Busca inteligente Status Pedidos — todos os checks passaram.");
  } else {
    console.error(`✗ ${failed} check(s) falharam.`);
    process.exit(1);
  }
}

main();
