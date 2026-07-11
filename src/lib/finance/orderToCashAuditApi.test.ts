import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED,
  ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY,
  ORDER_TO_CASH_AUDIT_SORT_WHITELIST,
  OrderToCashAuditApiParseError,
  buildOrderToCashAuditFactWhere,
  buildOrderToCashAuditListPayload,
  buildOrderToCashAuditPrismaOrderBy,
  mapOrderToCashAuditFactToListRow,
  parseOrderToCashAuditListFilters,
  resolveOrderToCashAuditSort,
  type OrderToCashAuditFactRecord,
  type OrderToCashAuditListFilters,
} from "./orderToCashAuditApi.js";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function fact(
  partial: Partial<OrderToCashAuditFactRecord> & { id: string }
): OrderToCashAuditFactRecord {
  return {
    runId: "run-1",
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

function baseFilters(
  overrides: Partial<OrderToCashAuditListFilters> = {}
): OrderToCashAuditListFilters {
  return {
    customerExternalId: 200,
    customerId: null,
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
  it("1. sem cliente/ano retorna 400 amigável", () => {
    assert.throws(
      () => parseOrderToCashAuditListFilters({}),
      (err: unknown) =>
        err instanceof OrderToCashAuditApiParseError &&
        err.message === ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED
    );
    assert.throws(
      () => parseOrderToCashAuditListFilters({ year: 2026 }),
      (err: unknown) =>
        err instanceof OrderToCashAuditApiParseError &&
        err.message === ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED
    );
    assert.throws(
      () => parseOrderToCashAuditListFilters({ customerExternalId: 200 }),
      (err: unknown) =>
        err instanceof OrderToCashAuditApiParseError &&
        err.message === ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED
    );

    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(
      routes,
      /OrderToCashAuditApiParseError[\s\S]*status\(400\)/
    );
    assert.match(
      read("src/lib/finance/orderToCashAuditApi.ts"),
      /Selecione cliente e ano para pesquisar a auditoria Pedido → Caixa/
    );
  });

  it("2. com cliente/ano retorna payload", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: "200",
      year: "2026",
    });
    const payload = buildOrderToCashAuditListPayload({
      filters,
      run: {
        runId: "run-1",
        startedAt: "2026-07-10T12:00:00.000Z",
        finishedAt: "2026-07-10T12:05:00.000Z",
        status: "SUCCESS",
        year: 2026,
        totalFacts: 1,
        mode: "apply",
      },
      pageRows: [fact({ id: "f1" })],
      summaryFacts: [fact({ id: "f1" })],
      totalRows: 1,
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.requiredSelection.readyToSearch, true);
    assert.equal(payload.requiredSelection.customerRequired, true);
    assert.equal(payload.requiredSelection.yearRequired, true);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].orderCode, "PD 02339");
    assert.ok(payload.summary);
    assert.ok(payload.pagination);
    assert.ok(payload.sorting);
    assert.ok(payload.availableFilters);
    assert.equal(payload.run?.runId, "run-1");
  });

  it("3. paginação funciona", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      page: "2",
      pageSize: "10",
    });
    assert.equal(filters.page, 2);
    assert.equal(filters.pageSize, 10);

    const all = Array.from({ length: 25 }, (_, i) =>
      fact({ id: `f${i}`, orderCode: `PD ${i}` })
    );
    const pageRows = all.slice(10, 20);
    const payload = buildOrderToCashAuditListPayload({
      filters,
      run: null,
      pageRows,
      summaryFacts: all,
      totalRows: 25,
    });
    assert.equal(payload.pagination.page, 2);
    assert.equal(payload.pagination.pageSize, 10);
    assert.equal(payload.pagination.totalRows, 25);
    assert.equal(payload.pagination.totalPages, 3);
    assert.equal(payload.rows.length, 10);
    assert.equal(payload.summary.totalRows, 25);
  });

  it("4. ordenação por coluna permitida funciona", () => {
    const { sortBy, sortDirection } = resolveOrderToCashAuditSort(
      "sellerName",
      "asc"
    );
    assert.equal(sortBy, "sellerName");
    assert.equal(sortDirection, "asc");
    const orderBy = buildOrderToCashAuditPrismaOrderBy(sortBy, sortDirection);
    assert.deepEqual(orderBy, [{ sellerName: "asc" }, { id: "asc" }]);
    assert.ok(
      ORDER_TO_CASH_AUDIT_SORT_WHITELIST.includes(sortBy as (typeof ORDER_TO_CASH_AUDIT_SORT_WHITELIST)[number])
    );
  });

  it("5. sortBy inválido cai no default seguro", () => {
    const { sortBy, sortDirection } = resolveOrderToCashAuditSort(
      "DROP TABLE facts; --",
      "weird"
    );
    assert.equal(sortBy, ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY);
    assert.equal(sortDirection, "desc");
    const orderBy = buildOrderToCashAuditPrismaOrderBy(sortBy, sortDirection);
    assert.equal(Object.keys(orderBy[0]).length, 1);
    assert.ok("orderIssueDate" in orderBy[0]);
    assert.doesNotMatch(JSON.stringify(orderBy), /DROP TABLE/);
  });

  it("6. filtros por estágio funcionam", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      orderToCashStage: "BLOQUEADO_REVISAO",
      operationalStage: "ENTREGUE",
      financialStage: "CR_ABERTO",
    });
    const where = buildOrderToCashAuditFactWhere(filters, "run-1");
    assert.ok(where.AND);
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(and.some((c) => c.orderToCashStage === "BLOQUEADO_REVISAO"));
    assert.ok(and.some((c) => c.operationalStage === "ENTREGUE"));
    assert.ok(and.some((c) => c.financialStage === "CR_ABERTO"));

    const payload = buildOrderToCashAuditListPayload({
      filters,
      run: null,
      pageRows: [
        fact({ id: "a", orderToCashStage: "BLOQUEADO_REVISAO" }),
        fact({ id: "b", orderToCashStage: "EM_ANDAMENTO" }),
      ].filter((r) => r.orderToCashStage === "BLOQUEADO_REVISAO"),
      summaryFacts: [fact({ id: "a", orderToCashStage: "BLOQUEADO_REVISAO" })],
      totalRows: 1,
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].orderToCashStage, "BLOQUEADO_REVISAO");
    assert.equal(payload.summary.stageCounts.BLOQUEADO_REVISAO, 1);
  });

  it("7. filtros por alerta funcionam", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      hasAlerts: "true",
      onlyWithExcess: "true",
      onlyOverdue: "1",
    });
    assert.equal(filters.hasAlerts, true);
    assert.equal(filters.onlyWithExcess, true);
    assert.equal(filters.onlyOverdue, true);

    const where = buildOrderToCashAuditFactWhere(filters, "run-1");
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(and.some((c) => c.hasExcessQuantity === true));
    assert.ok(and.some((c) => c.hasOverdueReceivable === true));
    assert.ok(and.some((c) => c.OR != null));

    const row = mapOrderToCashAuditFactToListRow(
      fact({
        id: "alert-1",
        hasExcessQuantity: true,
        hasOverdueReceivable: true,
        alertsJson: ["EXCESSO_QTDE", "CR_VENCIDO"],
      })
    );
    assert.deepEqual(row.alerts, ["EXCESSO_QTDE", "CR_VENCIDO"]);
    assert.equal(row.hasExcessQuantity, true);
    assert.equal(row.hasOverdueReceivable, true);
  });

  it("8. não expõe Prisma error", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /order-to-cash-audit/);
    assert.match(routes, /financeApiErrorJson/);
    assert.match(
      routes,
      /Erro ao carregar auditoria Pedido → Caixa/
    );
    assert.match(
      routes,
      /Falha interna ao consultar fatos materializados/
    );

    const payload = buildOrderToCashAuditListPayload({
      filters: baseFilters(),
      run: null,
      pageRows: [fact({ id: "f1" })],
      summaryFacts: [fact({ id: "f1" })],
      totalRows: 1,
    });
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /PrismaClient|Prisma\.|stack/i);
    assert.doesNotMatch(serialized, /traceJson|paymentTermsJson/);
  });

  it("9. não faz write", () => {
    const server = read("src/lib/financeOrderToCashAuditApi.server.ts");
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.doesNotMatch(server, /\.(create|update|upsert|deleteMany|delete)\s*\(/);
    assert.doesNotMatch(server, /\$executeRaw|\$queryRawUnsafe/);
    assert.match(server, /findMany|findFirst|findUnique|count/);
    assert.match(routes, /app\.get\(\s*"\/api\/finance\/portfolio-reconciliation\/order-to-cash-audit"/);
    assert.doesNotMatch(
      routes,
      /app\.(post|put|patch|delete)\(\s*"\/api\/finance\/portfolio-reconciliation\/order-to-cash-audit/
    );
  });

  it("10. não usa proposta", () => {
    const api = read("src/lib/finance/orderToCashAuditApi.ts");
    const server = read("src/lib/financeOrderToCashAuditApi.server.ts");
    for (const src of [api, server]) {
      assert.doesNotMatch(src, /from ["'][^"']*proposta/i);
      assert.doesNotMatch(src, /from ["'][^"']*Proposal/i);
      assert.doesNotMatch(src, /\bprisma\.proposal/i);
      assert.doesNotMatch(src, /\bProposal\b/);
    }
  });

  it("11. não usa comissão", () => {
    const api = read("src/lib/finance/orderToCashAuditApi.ts");
    const server = read("src/lib/financeOrderToCashAuditApi.server.ts");
    for (const src of [api, server]) {
      assert.doesNotMatch(src, /from ["'][^"']*comiss/i);
      assert.doesNotMatch(src, /from ["'][^"']*commission/i);
      assert.doesNotMatch(src, /\bprisma\.commission/i);
      assert.doesNotMatch(src, /\bCommission\b/);
    }
  });

  it("pageSize respeita máximo 200", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerExternalId: 200,
      year: 2026,
      pageSize: "999",
    });
    assert.equal(filters.pageSize, 200);
  });

  it("customerId também habilita busca", () => {
    const filters = parseOrderToCashAuditListFilters({
      customerId: "cust-uuid",
      year: 2026,
    });
    assert.equal(filters.customerId, "cust-uuid");
    assert.equal(filters.customerExternalId, null);
  });
});
