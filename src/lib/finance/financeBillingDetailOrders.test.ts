/**
 * Contrato puro da subaba Financeiro > Faturamento > Detalhamento.
 * Sem Prisma: parsing de filtros, competência canônica e ordenação.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceBillingDetailOrderTerms,
  buildFinanceBillingDetailOrdersQuery,
  compareFinanceBillingDetailOrders,
  createDefaultFinanceBillingDetailFilters,
  financeBillingDetailPeriodLabel,
  FinanceBillingDetailQueryError,
  FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT,
  hasPendingFinanceBillingDetailFilterChanges,
  isWithinFinanceBillingDetailPeriod,
  normalizeFinanceBillingDetailFilters,
  onlyDigits,
  parseFinanceBillingDetailExternalId,
  parseFinanceBillingDetailOrdersQuery,
  resolveFinanceBillingDetailCompetenceDate,
  resolveFinanceBillingDetailPeriod,
  type FinanceBillingDetailOrderItem,
} from "./financeBillingDetailOrders.ts";

const REF = new Date(2026, 8, 1, 12, 0, 0, 0); // 01/09/2026

function item(
  partial: Partial<FinanceBillingDetailOrderItem> &
    Pick<FinanceBillingDetailOrderItem, "salesOrderId" | "orderCode">
): FinanceBillingDetailOrderItem {
  return {
    externalSalesOrderCode: null,
    externalSalesOrderId: null,
    customerId: null,
    customerName: "Cliente",
    customerDocument: null,
    companyName: null,
    firstInvoiceDate: null,
    lastInvoiceDate: null,
    invoices: [],
    outputDocuments: [],
    ...partial,
  };
}

describe("financeBillingDetailOrders — contrato", () => {
  it("expõe o endpoint sob o prefixo canônico de Faturamento", () => {
    assert.equal(
      FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT,
      "/api/finance/billing/detail/orders"
    );
  });

  it("default abre no mês corrente (Ano + Mês preenchidos)", () => {
    const defaults = createDefaultFinanceBillingDetailFilters(REF);
    assert.equal(defaults.year, "2026");
    assert.equal(defaults.month, "9");
    assert.equal(defaults.customerId, "");
    assert.equal(defaults.salesOrder, "");
    assert.equal(defaults.outputDocument, "");
    assert.equal(defaults.invoice, "");
  });

  it("draft × applied: só acusa mudança pendente quando algo muda de fato", () => {
    const applied = createDefaultFinanceBillingDetailFilters(REF);
    assert.equal(
      hasPendingFinanceBillingDetailFilterChanges({ ...applied }, applied),
      false
    );
    assert.equal(
      hasPendingFinanceBillingDetailFilterChanges(
        { ...applied, invoice: " 7731 " },
        applied
      ),
      true
    );
    // Espaço em branco não conta como mudança (normalização).
    assert.equal(
      hasPendingFinanceBillingDetailFilterChanges(
        { ...applied, salesOrder: "  " },
        applied
      ),
      false
    );
  });

  it("normaliza filtros aparando espaços", () => {
    const normalized = normalizeFinanceBillingDetailFilters({
      ...createDefaultFinanceBillingDetailFilters(REF),
      salesOrder: "  PD 02716 ",
      invoice: " 7731 ",
      outputDocument: " 8572 ",
    });
    assert.equal(normalized.salesOrder, "PD 02716");
    assert.equal(normalized.invoice, "7731");
    assert.equal(normalized.outputDocument, "8572");
  });

  it("query string só carrega filtros preenchidos", () => {
    const qs = buildFinanceBillingDetailOrdersQuery(
      {
        ...createDefaultFinanceBillingDetailFilters(REF),
        customerId: "11111111-1111-4111-8111-111111111111",
        invoice: "7731",
      },
      { page: 2, pageSize: 25, sortBy: "orderCode", sortDir: "asc" }
    );
    const params = new URLSearchParams(qs);
    assert.equal(params.get("year"), "2026");
    assert.equal(params.get("month"), "9");
    assert.equal(params.get("invoice"), "7731");
    assert.equal(params.get("customerId"), "11111111-1111-4111-8111-111111111111");
    assert.equal(params.get("page"), "2");
    assert.equal(params.get("pageSize"), "25");
    assert.equal(params.get("sortBy"), "orderCode");
    assert.equal(params.get("sortDir"), "asc");
    assert.equal(params.get("salesOrder"), null);
    assert.equal(params.get("outputDocument"), null);
  });

  it("parse aplica defaults seguros e recusa ordenação desconhecida", () => {
    const filters = parseFinanceBillingDetailOrdersQuery({}, REF);
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, null);
    assert.equal(filters.page, 1);
    assert.equal(filters.pageSize, 50);
    assert.equal(filters.sortBy, "invoiceDate");
    assert.equal(filters.sortDir, "desc");

    assert.throws(
      () => parseFinanceBillingDetailOrdersQuery({ sortBy: "totalValue" }, REF),
      FinanceBillingDetailQueryError
    );
    assert.throws(
      () => parseFinanceBillingDetailOrdersQuery({ sortDir: "up" }, REF),
      FinanceBillingDetailQueryError
    );
  });

  it("pageSize tem teto (não permite dump da base)", () => {
    const filters = parseFinanceBillingDetailOrdersQuery({ pageSize: "100000" }, REF);
    assert.equal(filters.pageSize, 200);
  });

  it("customerId só é aceito como UUID IndusCost", () => {
    const uuid = parseFinanceBillingDetailOrdersQuery(
      { customerId: "11111111-1111-4111-8111-111111111111" },
      REF
    );
    assert.equal(uuid.customerId, "11111111-1111-4111-8111-111111111111");
    // Id numérico Nomus não é o identificador desta consulta.
    const numeric = parseFinanceBillingDetailOrdersQuery({ customerId: "4321" }, REF);
    assert.equal(numeric.customerId, null);
  });

  it("período Ano/Mês usa fim exclusivo e cobre a virada de dezembro", () => {
    const onlyYear = resolveFinanceBillingDetailPeriod({ year: 2026, month: null });
    assert.deepEqual(onlyYear, {
      gte: new Date(2026, 0, 1),
      lt: new Date(2027, 0, 1),
    });

    const december = resolveFinanceBillingDetailPeriod({ year: 2026, month: 12 });
    assert.deepEqual(december, {
      gte: new Date(2026, 11, 1),
      lt: new Date(2027, 0, 1),
    });
  });

  it("competência canônica = xmlDhEmi → dataProcessamento → data do vínculo", () => {
    const issue = new Date(2026, 7, 10);
    const processing = new Date(2026, 7, 12);
    const link = new Date(2026, 7, 14);

    assert.equal(
      resolveFinanceBillingDetailCompetenceDate({
        nfeIssueDate: issue,
        nfeProcessingDate: processing,
        linkProcessingDate: link,
      }),
      issue
    );
    assert.equal(
      resolveFinanceBillingDetailCompetenceDate({
        nfeIssueDate: null,
        nfeProcessingDate: processing,
        linkProcessingDate: link,
      }),
      processing
    );
    assert.equal(
      resolveFinanceBillingDetailCompetenceDate({
        nfeIssueDate: null,
        nfeProcessingDate: null,
        linkProcessingDate: link,
      }),
      link
    );
    // Sem nenhuma data não há faturamento — não inventa createdAt/updatedAt.
    assert.equal(resolveFinanceBillingDetailCompetenceDate({}), null);
  });

  it("janela do período é [gte, lt)", () => {
    const period = { gte: new Date(2026, 7, 1), lt: new Date(2026, 8, 1) };
    assert.equal(isWithinFinanceBillingDetailPeriod(new Date(2026, 7, 1), period), true);
    assert.equal(isWithinFinanceBillingDetailPeriod(new Date(2026, 7, 31), period), true);
    assert.equal(isWithinFinanceBillingDetailPeriod(new Date(2026, 8, 1), period), false);
    assert.equal(isWithinFinanceBillingDetailPeriod(null, period), false);
  });

  it("termos de pedido cobrem número puro e formato PD apresentado ao usuário", () => {
    const terms = buildFinanceBillingDetailOrderTerms("2716");
    assert.ok(terms.includes("2716"));
    assert.ok(terms.includes("PD2716"));
    assert.ok(terms.some((t) => /^PD\s0*2716$/.test(t)));

    const fromLabel = buildFinanceBillingDetailOrderTerms("PD 02716");
    assert.ok(fromLabel.includes("PD 02716"));
    assert.ok(fromLabel.includes("2716"));
  });

  it("helpers numéricos e de documento", () => {
    assert.equal(parseFinanceBillingDetailExternalId("8572"), 8572);
    assert.equal(parseFinanceBillingDetailExternalId("PD8572"), null);
    assert.equal(parseFinanceBillingDetailExternalId("0"), null);
    assert.equal(onlyDigits("12.345.678/0001-90"), "12345678000190");
    assert.equal(onlyDigits(null), "");
  });

  it("rótulo do período", () => {
    assert.equal(financeBillingDetailPeriodLabel(2026, 9), "Setembro/2026");
    assert.equal(financeBillingDetailPeriodLabel(2026, null), "Ano 2026");
  });

  it("ordenação padrão: faturamentos mais recentes primeiro", () => {
    const older = item({
      salesOrderId: "a",
      orderCode: "PD 00001",
      lastInvoiceDate: "2026-08-02T00:00:00.000Z",
    });
    const newer = item({
      salesOrderId: "b",
      orderCode: "PD 00002",
      lastInvoiceDate: "2026-08-20T00:00:00.000Z",
    });
    const sorted = [older, newer].sort((a, b) =>
      compareFinanceBillingDetailOrders(a, b, "invoiceDate", "desc")
    );
    assert.deepEqual(
      sorted.map((r) => r.orderCode),
      ["PD 00002", "PD 00001"]
    );
  });

  it("ordenação por pedido e por cliente respeita a direção", () => {
    const a = item({ salesOrderId: "a", orderCode: "PD 00002", customerName: "Zeta" });
    const b = item({ salesOrderId: "b", orderCode: "PD 00010", customerName: "Alfa" });

    assert.deepEqual(
      [a, b]
        .sort((x, y) => compareFinanceBillingDetailOrders(x, y, "orderCode", "asc"))
        .map((r) => r.orderCode),
      ["PD 00002", "PD 00010"]
    );
    assert.deepEqual(
      [a, b]
        .sort((x, y) => compareFinanceBillingDetailOrders(x, y, "customerName", "asc"))
        .map((r) => r.customerName),
      ["Alfa", "Zeta"]
    );
  });

  it("linhas sem data de faturamento vão para o fim (não para o topo)", () => {
    const withDate = item({
      salesOrderId: "a",
      orderCode: "PD 00001",
      lastInvoiceDate: "2026-08-02T00:00:00.000Z",
    });
    const withoutDate = item({ salesOrderId: "b", orderCode: "PD 00002" });
    const sorted = [withoutDate, withDate].sort((a, b) =>
      compareFinanceBillingDetailOrders(a, b, "invoiceDate", "asc")
    );
    assert.deepEqual(
      sorted.map((r) => r.orderCode),
      ["PD 00001", "PD 00002"]
    );
  });
});
