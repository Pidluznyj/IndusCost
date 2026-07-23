import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED,
  ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY,
  ORDER_TO_CASH_AUDIT_GENERAL_SUCCESS_RUN_WHERE,
  ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
  ORDER_TO_CASH_AUDIT_SORT_WHITELIST,
  buildOrderToCashAuditFactWhere,
  buildOrderToCashAuditListPayload,
  buildOrderToCashAuditListSummary,
  buildOrderToCashAuditListSummaryFromRun,
  buildOrderToCashAuditPrismaOrderBy,
  buildOrderToCashAuditSpecificCustomerYearRunWhere,
  decideOrderToCashAuditRunPolicy,
  isOrderToCashAuditGeneralRunScope,
  mapOrderToCashAuditFactToListRow,
  matchesOrderToCashAuditSpecificCustomerYearRun,
  orderToCashAuditHasFactScopeFilters,
  parseOrderToCashAuditListFilters,
  resolveOrderToCashAuditLineBilledValue,
  resolveOrderToCashAuditSort,
  type OrderToCashAuditFactRecord,
  type OrderToCashAuditListFilters,
  type OrderToCashAuditRunMeta,
} from "./orderToCashAuditApi.js";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const GENERAL_RUN_ID = "41c2470a-b685-4765-a954-77110fd8cf5c";
const BRITANIA_RUN_ID = "a0bdc0b6-b3d5-42ca-a548-283edbc31cfa";

function fact(
  partial: Partial<OrderToCashAuditFactRecord> & { id: string }
): OrderToCashAuditFactRecord {
  return {
    runId: GENERAL_RUN_ID,
    orderCode: "PD 02339",
    orderIssueDate: new Date(2026, 4, 1),
    orderExpectedDeliveryDate: null,
    orderNetValue: 1000,
    customerId: "cust-1",
    customerName: "Britânia",
    externalCustomerId: 200,
    sellerName: "João",
    sellerQualityStatus: "OK",
    productCode: "P1",
    sku: "SKU-1",
    productName: "Produto 1",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 5,
    orderItemTotalValue: 50,
    stockDocumentId: "doc-1",
    stockDocumentExternalId: 7951,
    stockDocumentDate: new Date(2026, 4, 10),
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 50,
    allocatedValueByDocumentPrice: null,
    stockDocumentItemUnitValue: 5,
    stockDocumentItemTotalValue: 50,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeNumber: "6845",
    nfeIssueDate: new Date(2026, 4, 11),
    nfeHeaderValue: 50,
    receivableTotalValue: 50,
    receivableOpenValue: 50,
    receivableReceivedValue: 0,
    paymentDueDate: new Date(2026, 5, 1),
    paymentSettlementDate: null,
    paymentStatus: "OPEN",
    operationalStage: "ENTREGUE",
    financialStage: "CR_ABERTO",
    orderToCashStage: "EM_ANDAMENTO",
    temperature: "AMARELO",
    confidenceScore: 0.8,
    confidenceLabel: "ALTA",
    responsibleArea: "Financeiro",
    recommendedAction: "Acompanhar",
    alertsJson: [],
    blockingReasonsJson: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    salesOrderId: "order-1",
    ...partial,
  };
}

function generalRunMeta(
  overrides: Partial<OrderToCashAuditRunMeta> = {}
): OrderToCashAuditRunMeta {
  return {
    runId: GENERAL_RUN_ID,
    startedAt: "2026-07-10T12:00:00.000Z",
    finishedAt: "2026-07-10T12:05:00.000Z",
    status: "SUCCESS",
    mode: "APPLY",
    year: null,
    customerFilter: null,
    periodFrom: "2025-06-01T00:00:00.000Z",
    periodTo: "2026-12-31T00:00:00.000Z",
    totalOrders: 1283,
    totalFacts: 5860,
    totalOrderValue: 1_000_000,
    totalAllocatedValue: 900_000,
    totalReceivableValue: 800_000,
    totalReceivedValue: 400_000,
    totalOpenValue: 400_000,
    totalBlockedValue: 10_000,
    createdAt: "2026-07-10T12:00:00.000Z",
    isGeneralRun: true,
    ...overrides,
  };
}

function baseFilters(
  overrides: Partial<OrderToCashAuditListFilters> = {}
): OrderToCashAuditListFilters {
  return {
    customerExternalId: 200,
    customerId: null,
    customerName: null,
    year: 2026,
    page: 1,
    pageSize: 50,
    sortBy: "orderIssueDate",
    sortDirection: "desc",
    orderCode: null,
    sellerName: null,
    productCode: null,
    sku: null,
    nfeNumber: null,
    stockDocumentExternalId: null,
    orderToCashStage: null,
    operationalStage: null,
    financialStage: null,
    paymentStatus: null,
    temperature: null,
    confidenceLabel: null,
    hasAlerts: false,
    onlyWithExcess: false,
    onlyWithProductOutsideOrder: false,
    onlyWithoutDocument: false,
    onlyWithoutReceivable: false,
    onlyOverdue: false,
    runId: null,
    ...overrides,
  };
}

describe("orderToCashAuditApi", () => {
  it("1. sem filtros parseia e política aponta para run geral", () => {
    const filters = parseOrderToCashAuditListFilters({});
    assert.equal(filters.customerExternalId, null);
    assert.equal(filters.year, null);
    assert.equal(orderToCashAuditHasFactScopeFilters(filters), false);

    const decision = decideOrderToCashAuditRunPolicy({
      runId: null,
      customerExternalId: null,
      year: null,
      specificRunId: null,
      generalRunId: GENERAL_RUN_ID,
    });
    assert.equal(decision.kind, "general");
    assert.equal(decision.runId, GENERAL_RUN_ID);

    const payload = buildOrderToCashAuditListPayload({
      filters,
      run: generalRunMeta(),
      pageRows: [fact({ id: "f1" })],
      summaryFacts: [],
      totalRows: 5860,
      preferRunTotals: true,
    });
    assert.equal(payload.run?.runId, GENERAL_RUN_ID);
    assert.equal(payload.run?.isGeneralRun, true);
    assert.equal(payload.summary.summarySource, "run");
    assert.equal(payload.summary.totalOrders, 1283);
    assert.equal(payload.summary.totalRows, 5860);
    assert.equal(payload.rows.length, 1);
  });

  it("2. customerExternalId=200 + year=2026 prefere run específica", () => {
    const decision = decideOrderToCashAuditRunPolicy({
      runId: null,
      customerExternalId: 200,
      year: 2026,
      specificRunId: BRITANIA_RUN_ID,
      generalRunId: GENERAL_RUN_ID,
    });
    assert.equal(decision.kind, "specific_customer_year");
    assert.equal(decision.runId, BRITANIA_RUN_ID);

    const fallback = decideOrderToCashAuditRunPolicy({
      runId: null,
      customerExternalId: 200,
      year: 2026,
      specificRunId: null,
      generalRunId: GENERAL_RUN_ID,
    });
    assert.equal(fallback.kind, "general");
    assert.equal(fallback.runId, GENERAL_RUN_ID);
  });

  it("3. filtro Britânia na run geral usa externalCustomerId (nunca customerId)", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: "200",
      year: "2026",
    });
    const where = buildOrderToCashAuditFactWhere(filters, GENERAL_RUN_ID, {
      isGeneralRun: true,
    });
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(and.some((c) => c.externalCustomerId === 200));
    assert.ok(!and.some((c) => "customerId" in c));
    assert.ok(
      and.some(
        (c) =>
          c.OR != null &&
          JSON.stringify(c).includes("orderIssueDate")
      )
    );

    // 108 linhas / 35 pedidos (janela geral Britânia)
    const orderIds = Array.from({ length: 35 }, (_, i) => `order-${i + 1}`);
    const rows = Array.from({ length: 108 }, (_, i) => {
      const orderId = orderIds[i % 35]!;
      return fact({
        id: `f${i}`,
        salesOrderId: orderId,
        orderCode: `PD ${orderId}`,
        sellerName: i % 7 === 0 ? "Sem vendedor informado" : null,
        nfeNumber: i % 5 === 0 ? null : "6845",
        receivableTotalValue: i % 3 === 0 ? null : 50,
      });
    });
    assert.equal(rows.length, 108);

    const summary = buildOrderToCashAuditListSummary(rows, 108);
    assert.equal(summary.totalRows, 108);
    assert.equal(summary.totalOrders, 35);
    assert.equal(summary.summarySource, "filtered_facts");
    // CR não duplica 108× — max por pedido
    assert.ok(summary.totalReceivableValue <= 35 * 50 + 1);

    const payload = buildOrderToCashAuditListPayload({
      filters,
      run: generalRunMeta(),
      pageRows: rows.slice(0, 50),
      summaryFacts: rows,
      totalRows: 108,
    });
    assert.equal(payload.pagination.totalRows, 108);
    assert.equal(payload.rows.length, 50);
    assert.ok(payload.rows.length > 0);
  });

  it("4. sem run materializada retorna mensagem amigável", () => {
    const decision = decideOrderToCashAuditRunPolicy({
      runId: null,
      customerExternalId: null,
      year: null,
      specificRunId: null,
      generalRunId: null,
    });
    assert.equal(decision.kind, "none");

    const payload = buildOrderToCashAuditListPayload({
      filters: parseOrderToCashAuditListFilters({}),
      run: null,
      pageRows: [],
      summaryFacts: [],
      totalRows: 0,
      message: ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
    });
    assert.equal(payload.message, ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE);
    assert.equal(payload.rows.length, 0);
    assert.match(
      read("src/lib/financeOrderToCashAuditApi.server.ts"),
      /ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE/
    );
  });

  it("5. paginação e ordenação server-side com whitelist", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      page: "2",
      pageSize: "10",
    });
    assert.equal(filters.page, 2);
    assert.equal(filters.pageSize, 10);

    const { sortBy, sortDirection } = resolveOrderToCashAuditSort(
      "sellerName",
      "asc"
    );
    assert.equal(sortBy, "sellerName");
    const orderBy = buildOrderToCashAuditPrismaOrderBy(sortBy, sortDirection);
    assert.deepEqual(orderBy, [{ sellerName: "asc" }, { id: "asc" }]);

    const bad = resolveOrderToCashAuditSort("DROP TABLE facts; --", "weird");
    assert.equal(bad.sortBy, ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY);
    assert.ok(
      ORDER_TO_CASH_AUDIT_SORT_WHITELIST.includes(
        bad.sortBy as (typeof ORDER_TO_CASH_AUDIT_SORT_WHITELIST)[number]
      )
    );
  });

  it("6. sellerName Sem vendedor informado e fields null não quebram", () => {
    const row = mapOrderToCashAuditFactToListRow(
      fact({
        id: "nullish",
        sellerName: "Sem vendedor informado",
        productCode: null,
        sku: null,
        nfeNumber: null,
        stockDocumentExternalId: null,
        orderIssueDate: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        paymentStatus: null,
        temperature: null,
        alertsJson: null,
      })
    );
    assert.equal(row.sellerName, "Sem vendedor informado");
    assert.equal(row.productCode, null);
    assert.deepEqual(row.alerts, []);

    const filters = baseFilters({ sellerName: "Sem vendedor informado" });
    const where = buildOrderToCashAuditFactWhere(filters, GENERAL_RUN_ID, {
      isGeneralRun: true,
    });
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(
      and.some(
        (c) =>
          c.sellerName != null &&
          typeof c.sellerName === "object" &&
          (c.sellerName as { contains: string }).contains ===
            "Sem vendedor informado"
      )
    );
  });

  it("7. customerName filtra por nome; customerId não entra no where de Fact", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerName: "Britânia",
      year: 2026,
    });
    const where = buildOrderToCashAuditFactWhere(filters, GENERAL_RUN_ID, {
      isGeneralRun: true,
    });
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(
      and.some(
        (c) =>
          c.customerName != null &&
          typeof c.customerName === "object" &&
          (c.customerName as { contains: string }).contains === "Britânia"
      )
    );
    assert.ok(!JSON.stringify(where).includes('"customerId"'));

    assert.match(
      ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED,
      /customerExternalId/
    );
    assert.match(
      read("src/lib/financeOrderToCashAuditApi.server.ts"),
      /Nunca usa customerId como filtro de Fact/
    );
  });

  it("8. ano na run geral filtra orderIssueDate; run específica não reaplica ano", () => {
    const filters = baseFilters();
    const generalWhere = buildOrderToCashAuditFactWhere(filters, GENERAL_RUN_ID, {
      isGeneralRun: true,
    });
    assert.match(JSON.stringify(generalWhere), /orderIssueDate/);

    const specificWhere = buildOrderToCashAuditFactWhere(
      filters,
      BRITANIA_RUN_ID,
      { isGeneralRun: false }
    );
    assert.doesNotMatch(JSON.stringify(specificWhere), /orderIssueDate/);
  });

  it("9. summary da run geral sem filtro usa totais da run", () => {
    const run = generalRunMeta();
    const summary = buildOrderToCashAuditListSummaryFromRun(run, 5860);
    assert.equal(summary.summarySource, "run");
    assert.equal(summary.totalOrders, 1283);
    assert.equal(summary.totalRows, 5860);
    assert.equal(summary.totalReceivableValue, 800_000);
  });

  it("10. não expõe Prisma error / não faz write / não usa proposta ou comissão", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /order-to-cash-audit/);
    assert.match(routes, /financeApiErrorJson/);

    const server = read("src/lib/financeOrderToCashAuditApi.server.ts");
    assert.doesNotMatch(server, /\.(create|update|upsert|deleteMany|delete)\s*\(/);
    assert.doesNotMatch(server, /\$executeRaw|\$queryRawUnsafe/);
    assert.match(server, /findMany|findFirst|findUnique|count/);

    for (const src of [read("src/lib/finance/orderToCashAuditApi.ts"), server]) {
      assert.doesNotMatch(src, /from ["'][^"']*proposta/i);
      assert.doesNotMatch(src, /\bprisma\.proposal/i);
      assert.doesNotMatch(src, /from ["'][^"']*commission/i);
      assert.doesNotMatch(src, /\bprisma\.commission/i);
    }

    const payload = buildOrderToCashAuditListPayload({
      filters: baseFilters(),
      run: generalRunMeta(),
      pageRows: [fact({ id: "f1" })],
      summaryFacts: [fact({ id: "f1" })],
      totalRows: 1,
    });
    assert.doesNotMatch(JSON.stringify(payload), /PrismaClient|stack/i);
  });

  it("pageSize respeita máximo 200", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      pageSize: "999",
    });
    assert.equal(filters.pageSize, 200);
  });

  it("meta da run inclui campos exigidos pela API", () => {
    const run = generalRunMeta();
    assert.equal(run.runId, GENERAL_RUN_ID);
    assert.equal(run.isGeneralRun, true);
    assert.equal(run.customerFilter, null);
    assert.ok(run.periodFrom);
    assert.ok(run.periodTo);
    assert.equal(run.totalOrders, 1283);
    assert.equal(run.totalFacts, 5860);
    assert.ok(run.createdAt);
  });

  it("lineBilledValue prioriza item do documento e não usa CR total", () => {
    const fromStock = resolveOrderToCashAuditLineBilledValue({
      lineType: "ORDER_ITEM_ALLOCATED",
      quantityUsedForOrder: 10,
      stockDocumentItemUnitValue: 3.35,
      stockDocumentItemTotalValue: 99999,
      allocatedValueByDocumentPrice: 50,
    });
    assert.equal(fromStock.lineBilledValue, 33.5);
    assert.equal(fromStock.lineBilledValueSource, "STOCK_DOCUMENT_ITEM");

    const surplus = resolveOrderToCashAuditLineBilledValue({
      lineType: "QUANTITY_SURPLUS",
      excessQuantity: 1800,
      stockDocumentItemUnitValue: 2.89,
    });
    assert.equal(surplus.lineBilledValue, 1800 * 2.89);
    assert.equal(surplus.lineBilledValueSource, "STOCK_DOCUMENT_ITEM");

    const extra = resolveOrderToCashAuditLineBilledValue({
      lineType: "DOCUMENT_EXTRA_ITEM",
      outsideOrderQuantity: 5,
      stockDocumentItemUnitValue: 10,
    });
    assert.equal(extra.lineBilledValue, 50);

    const pending = resolveOrderToCashAuditLineBilledValue({
      lineType: "ORDER_ITEM_PENDING",
    });
    assert.equal(pending.lineBilledValue, null);
    assert.equal(pending.lineBilledValueSource, "NOT_BILLED");
    assert.equal(pending.lineBilledValueLabel, "Não faturado nesta NF");

    const row = mapOrderToCashAuditFactToListRow(
      fact({
        id: "pending-1",
        lineType: "ORDER_ITEM_PENDING",
        stockDocumentItemQuantity: null,
        stockDocumentItemUnitValue: null,
        stockDocumentItemTotalValue: null,
        allocatedValueByDocumentPrice: null,
        receivableTotalValue: 183_612,
        nfeNumber: "7228",
      })
    );
    assert.equal(row.lineBilledValue, null);
    assert.equal(row.lineBilledValueSource, "NOT_BILLED");
    assert.equal(row.receivableTotalValue, null);
    assert.equal(row.nfeNumber, null);
    assert.equal(row.evidenceLevel, "ORDER_TITLE");
  });
});

describe("OP-22 — run O2C geral vs escopado", () => {
  it("A. run geral válido é elegível como geral", () => {
    assert.equal(
      isOrderToCashAuditGeneralRunScope({
        customerFilter: null,
        sellerFilter: null,
        orderFilter: null,
      }),
      true
    );
    assert.deepEqual(ORDER_TO_CASH_AUDIT_GENERAL_SUCCESS_RUN_WHERE, {
      status: "SUCCESS",
      customerFilter: null,
      sellerFilter: null,
      orderFilter: null,
    });
  });

  it("B. run escopado por pedido não é elegível como geral", () => {
    assert.equal(
      isOrderToCashAuditGeneralRunScope({
        customerFilter: null,
        sellerFilter: null,
        orderFilter: "PD 02716",
      }),
      false
    );
  });

  it("C. run escopado por vendedor não é elegível como geral", () => {
    assert.equal(
      isOrderToCashAuditGeneralRunScope({
        customerFilter: null,
        sellerFilter: "VENDEDOR X",
        orderFilter: null,
      }),
      false
    );
  });

  it("D. run específico de cliente/ano (sem pedido/vendedor) é elegível", () => {
    assert.equal(
      matchesOrderToCashAuditSpecificCustomerYearRun(
        {
          status: "SUCCESS",
          year: 2026,
          customerFilter: "200",
          sellerFilter: null,
          orderFilter: null,
        },
        200,
        2026
      ),
      true
    );
    assert.deepEqual(
      buildOrderToCashAuditSpecificCustomerYearRunWhere(200, 2026),
      {
        status: "SUCCESS",
        year: 2026,
        customerFilter: "200",
        sellerFilter: null,
        orderFilter: null,
      }
    );
  });

  it("E. run específico de cliente com orderFilter não é elegível", () => {
    assert.equal(
      matchesOrderToCashAuditSpecificCustomerYearRun(
        {
          status: "SUCCESS",
          year: 2026,
          customerFilter: "200",
          sellerFilter: null,
          orderFilter: "PD 02716",
        },
        200,
        2026
      ),
      false
    );
  });

  it("F. runId explícito continua sendo respeitado", () => {
    const decision = decideOrderToCashAuditRunPolicy({
      runId: "explicit-run-id",
      customerExternalId: 200,
      year: 2026,
      specificRunId: BRITANIA_RUN_ID,
      generalRunId: GENERAL_RUN_ID,
    });
    assert.equal(decision.kind, "explicit");
    assert.equal(decision.runId, "explicit-run-id");
  });

  it("consumidores de produção reutilizam o where compartilhado do run geral", () => {
    const consumers = [
      "src/lib/financeOrderToCashAuditApi.server.ts",
      "src/lib/financeOrderStatusPedidosApi.server.ts",
      "src/lib/financePortfolioOrderStatusApi.server.ts",
      "src/lib/financePortfolioReconciliationApi.server.ts",
    ];
    for (const file of consumers) {
      const src = read(file);
      assert.match(src, /ORDER_TO_CASH_AUDIT_GENERAL_SUCCESS_RUN_WHERE/);
      assert.doesNotMatch(
        src,
        /where:\s*\{\s*status:\s*"SUCCESS",\s*customerFilter:\s*null\s*\}/
      );
    }
    const withSpecific = [
      "src/lib/financeOrderToCashAuditApi.server.ts",
      "src/lib/financeOrderStatusPedidosApi.server.ts",
      "src/lib/financePortfolioOrderStatusApi.server.ts",
    ];
    for (const file of withSpecific) {
      assert.match(
        read(file),
        /buildOrderToCashAuditSpecificCustomerYearRunWhere/
      );
    }
  });
});
