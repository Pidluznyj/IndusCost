import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceReport,
  isCommercialMetricsSalesOrder,
} from "./customerIntelligence.js";
import { createDefaultCustomerIntelligenceFilters } from "./customerIntelligenceUtils.js";
import type {
  CustomerIntelligenceBuildInput,
  CustomerIntelligenceOrderInput,
} from "./customerIntelligenceTypes.js";
import { CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS } from "./customerIntelligenceRoutes.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function baseCustomer(): CustomerIntelligenceBuildInput["customer"] {
  return {
    id: CUSTOMER_ID,
    companyName: "Cliente Teste LTDA",
    tradeName: "Cliente Teste",
    taxId: "12.345.678/0001-90",
    city: "Curitiba",
    state: "PR",
    accountOwner: "Maria",
    createdAt: new Date("2024-01-10T00:00:00.000Z"),
  };
}

function baseOrder(
  overrides: Partial<CustomerIntelligenceOrderInput> & Pick<CustomerIntelligenceOrderInput, "id">
): CustomerIntelligenceOrderInput {
  return {
    orderCode: overrides.orderCode ?? "PV-100",
    status: overrides.status ?? "SENT_TO_NOMUS",
    issueDate: overrides.issueDate ?? new Date("2025-03-15T12:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2025-03-16T12:00:00.000Z"),
    responsible: overrides.responsible ?? "Carlos",
    totalNetValue: overrides.totalNetValue ?? 5000,
    totalMarginValue: overrides.totalMarginValue ?? 500,
    totalMarginPerc: overrides.totalMarginPerc ?? 10,
    hasInvoicing: overrides.hasInvoicing ?? true,
    items: overrides.items ?? [
      {
        productId: "p1",
        quantity: 2,
        totalNetValue: 5000,
        Product: { id: "p1", sku: "SKU-A", name: "Produto A", type: "FINAL" },
      },
    ],
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<CustomerIntelligenceBuildInput> = {}
): CustomerIntelligenceBuildInput {
  return {
    customer: baseCustomer(),
    orders: [],
    activities: [],
    arRows: [],
    arLinkedByCnpj: false,
    filters: createDefaultCustomerIntelligenceFilters(NOW),
    now: NOW,
    ...overrides,
  };
}

describe("buildCustomerIntelligenceReport", () => {
  it("retorna estrutura completa do payload", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        orders: [baseOrder({ id: "o1" })],
      })
    );

    assert.ok(report.customer.id);
    assert.ok(report.filters);
    assert.ok(report.dataQuality);
    assert.ok(report.commercialSummary);
    assert.ok(report.history);
    assert.ok(report.seasonality);
    assert.ok(report.products);
    assert.ok(report.repurchase);
    assert.ok(report.financial);
    assert.ok(report.crm);
    assert.ok(Array.isArray(report.opportunities));
    assert.ok(Array.isArray(report.executiveNarrative));
  });

  it("pedido cancelado/erro fica fora dos indicadores principais", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [
          baseOrder({ id: "valid", totalNetValue: 1000 }),
          baseOrder({ id: "cancel", status: "CANCELLED", totalNetValue: 9000 }),
          baseOrder({ id: "err", status: "ERROR", totalNetValue: 9000 }),
        ],
      })
    );

    assert.equal(report.commercialSummary.validOrdersCount, 1);
    assert.equal(report.commercialSummary.revenue, 1000);
    assert.equal(report.commercialSummary.ordersCount, 3);
  });

  it("pedidos válidos entram na receita", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [
          baseOrder({ id: "o1", totalNetValue: 3000 }),
          baseOrder({
            id: "o2",
            issueDate: new Date("2025-08-01T12:00:00.000Z"),
            totalNetValue: 2000,
          }),
        ],
      })
    );

    assert.equal(report.commercialSummary.validOrdersCount, 2);
    assert.equal(report.commercialSummary.revenue, 5000);
    assert.equal(report.commercialSummary.averageTicket, 2500);
  });

  it("receita por ano calcula corretamente", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [
          baseOrder({
            id: "y2024",
            issueDate: new Date("2024-05-10T12:00:00.000Z"),
            totalNetValue: 4000,
          }),
          baseOrder({
            id: "y2025",
            issueDate: new Date("2025-05-10T12:00:00.000Z"),
            totalNetValue: 6000,
          }),
        ],
      })
    );

    const y2024 = report.history.byYear.find((y) => y.year === 2024);
    const y2025 = report.history.byYear.find((y) => y.year === 2025);
    assert.equal(y2024?.revenue, 4000);
    assert.equal(y2025?.revenue, 6000);
    assert.equal(y2024?.ordersCount, 1);
  });

  it("meses mais fortes calcula corretamente", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [
          baseOrder({
            id: "m3",
            issueDate: new Date("2025-03-01T12:00:00.000Z"),
            totalNetValue: 1000,
          }),
          baseOrder({
            id: "m5",
            issueDate: new Date("2025-05-01T12:00:00.000Z"),
            totalNetValue: 9000,
          }),
          baseOrder({
            id: "m5b",
            issueDate: new Date("2025-05-20T12:00:00.000Z"),
            totalNetValue: 1000,
          }),
        ],
      })
    );

    assert.ok(report.history.strongestMonths.length > 0);
    assert.equal(report.history.strongestMonths[0]!.month, 5);
    assert.equal(report.history.strongestMonths[0]!.revenue, 10000);
  });

  it("data primeira/última compra calcula corretamente", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null },
        orders: [
          baseOrder({
            id: "first",
            issueDate: new Date("2024-02-01T12:00:00.000Z"),
          }),
          baseOrder({
            id: "last",
            issueDate: new Date("2025-11-01T12:00:00.000Z"),
          }),
        ],
      })
    );

    assert.equal(report.customer.firstOrderDate, "2024-02-01");
    assert.equal(report.customer.lastOrderDate, "2025-11-01");
  });

  it("cliente sem pedidos não gera NaN", () => {
    const report = buildCustomerIntelligenceReport(buildInput());

    assert.equal(report.commercialSummary.validOrdersCount, 0);
    assert.equal(report.commercialSummary.revenue, 0);
    assert.equal(report.commercialSummary.averageTicket, null);
    assert.ok(!Number.isNaN(report.commercialSummary.revenue));
    assert.ok(report.repurchase.status === "INSUFICIENTE");
  });

  it("recompra com menos de 2 pedidos retorna histórico insuficiente", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        orders: [baseOrder({ id: "only" })],
      })
    );

    assert.equal(report.repurchase.status, "INSUFICIENTE");
    assert.equal(report.repurchase.medianDaysBetweenOrders, null);
  });

  it("produtos top por receita e quantidade funcionam", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        filters: { ...createDefaultCustomerIntelligenceFilters(NOW), year: null, topN: 10 },
        orders: [
          baseOrder({
            id: "o1",
            items: [
              {
                productId: "p-high",
                quantity: 1,
                totalNetValue: 8000,
                Product: { id: "p-high", sku: "H", name: "Alto", type: "FINAL" },
              },
              {
                productId: "p-qty",
                quantity: 50,
                totalNetValue: 500,
                Product: { id: "p-qty", sku: "Q", name: "Qty", type: "FINAL" },
              },
            ],
          }),
        ],
      })
    );

    assert.equal(report.products.topByRevenue[0]!.productId, "p-high");
    assert.equal(report.products.topByQuantity[0]!.productId, "p-qty");
  });

  it("região derivada por UF funciona", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({ orders: [baseOrder({ id: "o1" })] })
    );
    assert.equal(report.customer.region, "Sul");
  });

  it("financeiro retorna null/zero seguro quando não há AR vinculado", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({ arLinkedByCnpj: false, arRows: [] })
    );

    assert.equal(report.financial.linkedByCnpj, false);
    assert.equal(report.financial.receivableOpenAmount, null);
    assert.equal(report.financial.overdueAmount, null);
    assert.ok(report.dataQuality.warnings.some((w) => w.includes("Financeiro")));
  });

  it("financeiro com AR vinculado calcula saldos", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        arLinkedByCnpj: true,
        arRows: [
          {
            balanceReceivable: 1500,
            dueDate: new Date("2026-05-01T12:00:00.000Z"),
            settlementDate: null,
            amountReceivable: 1500,
            amountReceived: 0,
            suspendCollection: false,
          },
          {
            balanceReceivable: 500,
            dueDate: new Date("2026-08-01T12:00:00.000Z"),
            settlementDate: null,
            amountReceivable: 500,
            amountReceived: 0,
            suspendCollection: false,
          },
        ],
      })
    );

    assert.equal(report.financial.linkedByCnpj, true);
    assert.equal(report.financial.receivableOpenAmount, 2000);
    assert.ok((report.financial.overdueAmount ?? 0) > 0);
  });

  it("dataQuality mostra warnings de campos ausentes", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        customer: {
          ...baseCustomer(),
          accountOwner: null,
          city: null,
          state: null,
        },
      })
    );

    assert.ok(report.dataQuality.missingFields.includes("commercialOwner"));
    assert.ok(report.dataQuality.missingFields.includes("city"));
    assert.ok(report.dataQuality.missingFields.includes("region"));
  });

  it("dataQuality inclui SalesOrder como fonte comercial", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({ orders: [baseOrder({ id: "o1" })] })
    );
    assert.ok(report.dataQuality.sources.includes("SalesOrder"));
    assert.ok(report.dataQuality.sources.includes("SalesOrderItem"));
  });

  it("isCommercialMetricsSalesOrder exclui cancelados", () => {
    assert.equal(isCommercialMetricsSalesOrder("CANCELLED"), false);
    assert.equal(isCommercialMetricsSalesOrder("ERROR"), false);
    assert.equal(isCommercialMetricsSalesOrder("SENT_TO_NOMUS"), true);
  });
});

describe("customerIntelligenceRoutes — registro e segurança", () => {
  const serverSrc = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const routesSrc = readFileSync(join(process.cwd(), "src/lib/customerIntelligenceRoutes.ts"), "utf8");

  it("endpoint registrado no server.ts", () => {
    assert.ok(serverSrc.includes("registerCustomerIntelligenceRoutes"));
    assert.ok(routesSrc.includes("/api/crm/customers/:customerId/intelligence"));
  });

  it("endpoint exige autenticação e permissão", () => {
    assert.ok(routesSrc.includes("requireAppAuth"));
    assert.ok(routesSrc.includes("requireAnyPermission"));
    for (const perm of CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS) {
      assert.ok(routesSrc.includes(perm));
    }
  });

  it("sem hardcode por cliente/CNPJ/valor no assembler", () => {
    const assemblerSrc = readFileSync(
      join(process.cwd(), "src/lib/customerIntelligence.ts"),
      "utf8"
    );
    assert.ok(!assemblerSrc.includes("12.345.678"));
    assert.ok(!assemblerSrc.includes("11111111-1111"));
  });
});
