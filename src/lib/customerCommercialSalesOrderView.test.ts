import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildPortfolioAbcFromSalesOrders,
  computeCommercialPhase2FromSalesOrders,
  computeCustomerSalesOrderTicketAverage,
  isCommercialMetricsSalesOrder,
  isCommercialOpenSalesOrder,
  normalizeCustomerDocument,
  normalizeCustomerName,
  salesOrderHasInvoicing,
  salesOrderMatchesCustomer,
  safeCommercialNumber,
} from "./customerCommercialSalesOrderView.js";
import type { SalesOrderLinkStatus } from "@/src/types/commercial.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";

const BRITANIA_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

function testMarginSummary(input: {
  netRevenue: number;
  marginPercent: number;
}): SalesOrderMarginSummaryPayload {
  const marginValue = (input.netRevenue * input.marginPercent) / 100;
  return {
    netRevenue: input.netRevenue,
    totalCost: input.netRevenue - marginValue,
    marginValue,
    marginPercent: input.marginPercent,
    markup: input.netRevenue / (input.netRevenue - marginValue),
    itemsCount: 1,
    validItemsCount: 1,
    ignoredItemsCount: 0,
    hasMissingCost: false,
    hasMissingProduct: false,
    hasNegativeMargin: false,
    hasInvalidRevenue: false,
    status: "OK",
    statusLabel: "Calculada",
    statusSeverity: "success",
  };
}

function britaniaOrders() {
  return [
    {
      id: "so-1",
      orderCode: "PV-1001",
      status: "SENT_TO_NOMUS" as SalesOrderLinkStatus,
      issueDate: "2025-01-15T00:00:00.000Z",
      updatedAt: "2025-01-16T00:00:00.000Z",
      totalNetValue: 125000,
      marginSummary: testMarginSummary({ netRevenue: 125000, marginPercent: 18 }),
      responsible: "Carlos",
      hasInvoicing: true,
    },
    {
      id: "so-2",
      orderCode: "PV-1002",
      status: "READY_TO_SEND" as SalesOrderLinkStatus,
      issueDate: "2025-06-20T00:00:00.000Z",
      updatedAt: "2025-06-21T00:00:00.000Z",
      totalNetValue: 87500,
      marginSummary: testMarginSummary({ netRevenue: 87500, marginPercent: 16 }),
      responsible: "Carlos",
      hasInvoicing: false,
    },
  ];
}

describe("customerCommercialSalesOrderView", () => {
  it("normalizeCustomerDocument remove máscara do CNPJ", () => {
    assert.equal(normalizeCustomerDocument("12.345.678/0001-90"), "12345678000190");
  });

  it("normalizeCustomerName ignora acentos e caixa", () => {
    assert.equal(normalizeCustomerName("  Britânia Eletrodomésticos SA  "), "BRITANIA ELETRODOMESTICOS SA");
  });

  it("salesOrderMatchesCustomer por id e por documento", () => {
    const customer = { id: BRITANIA_ID, taxId: "12.345.678/0001-90" };
    assert.equal(salesOrderMatchesCustomer(BRITANIA_ID, customer, "12.345.678/0001-90"), true);
    assert.equal(salesOrderMatchesCustomer(OTHER_CUSTOMER_ID, customer, "12.345.678/0001-90"), true);
    assert.equal(salesOrderMatchesCustomer(OTHER_CUSTOMER_ID, customer, "99.999.999/0001-99"), false);
  });

  it("salesOrderHasInvoicing detecta dataProcessamento em nomusRawResponse", () => {
    assert.equal(
      salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "15/01/2025" }] }),
      true
    );
    assert.equal(salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "" }] }), false);
  });

  it("não importa salesOrderNfeLink (evita Prisma no bundle do navegador)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/customerCommercialSalesOrderView.ts"), "utf8");
    assert.doesNotMatch(src, /salesOrderNfeLink/);
    assert.doesNotMatch(src, /@prisma\/client/);
  });

  it("cliente com SalesOrder tem receita > 0 sem propostas", () => {
    const orders = britaniaOrders();
    const revenue = orders
      .filter((o) => isCommercialMetricsSalesOrder(o.status))
      .reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);
    assert.ok(revenue > 0);
    const abc = buildPortfolioAbcFromSalesOrders(
      [
        { customerId: BRITANIA_ID, revenue },
        { customerId: OTHER_CUSTOMER_ID, revenue: 10000 },
      ],
      BRITANIA_ID
    );
    assert.ok(abc.customerApprovedNet > 0);
    assert.ok(abc.abcClass != null);
  });

  it("cliente sem propostas mas com pedidos não fica Inativo", () => {
    const orders = britaniaOrders();
    const abc = buildPortfolioAbcFromSalesOrders(
      [{ customerId: BRITANIA_ID, revenue: 212500 }],
      BRITANIA_ID
    );
    const intel = computeCommercialPhase2FromSalesOrders(
      orders,
      abc,
      new Date("2025-07-01T12:00:00.000Z")
    );
    assert.notEqual(intel.health.level, "INATIVO");
    assert.ok(intel.health.score > 10);
  });

  it("Curva ABC usa soma de pedidos de venda", () => {
    const abc = buildPortfolioAbcFromSalesOrders(
      [
        { customerId: BRITANIA_ID, revenue: 80000 },
        { customerId: OTHER_CUSTOMER_ID, revenue: 20000 },
      ],
      BRITANIA_ID
    );
    assert.match(abc.basisLabel, /pedidos de venda/i);
    assert.equal(abc.abcClass, "A");
  });

  it("recompra usa intervalos entre issueDate dos pedidos", () => {
    const orders = britaniaOrders();
    const abc = buildPortfolioAbcFromSalesOrders([{ customerId: BRITANIA_ID, revenue: 212500 }], BRITANIA_ID);
    const intel = computeCommercialPhase2FromSalesOrders(orders, abc);
    assert.match(intel.repurchase.basis, /emissão de pedidos/i);
    assert.ok(intel.repurchase.medianDaysBetweenApprovals != null);
    assert.ok(intel.repurchase.medianDaysBetweenApprovals! > 100);
  });

  it("tendência compara últimos 180d vs 180d anteriores em pedidos", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const orders = [
      {
        id: "a",
        orderCode: "PV-A",
        status: "SENT_TO_NOMUS" as SalesOrderLinkStatus,
        issueDate: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        totalNetValue: 50000,
        marginSummary: testMarginSummary({ netRevenue: 50000, marginPercent: 10 }),
        hasInvoicing: true,
      },
      {
        id: "b",
        orderCode: "PV-B",
        status: "SENT_TO_NOMUS" as SalesOrderLinkStatus,
        issueDate: "2025-08-01T00:00:00.000Z",
        updatedAt: "2025-08-01T00:00:00.000Z",
        totalNetValue: 200000,
        marginSummary: testMarginSummary({ netRevenue: 200000, marginPercent: 10 }),
        hasInvoicing: true,
      },
    ];
    const abc = buildPortfolioAbcFromSalesOrders([{ customerId: BRITANIA_ID, revenue: 250000 }], BRITANIA_ID);
    const intel = computeCommercialPhase2FromSalesOrders(orders, abc, now);
    assert.equal(intel.trend.recent180dApprovedNet, 50000);
    assert.equal(intel.trend.prior180dApprovedNet, 200000);
    assert.ok(intel.trend.note != null);
  });

  it("ticket médio = receita / quantidade de pedidos válidos", () => {
    const orders = britaniaOrders();
    const revenue = orders.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);
    const ticket = computeCustomerSalesOrderTicketAverage(revenue, orders.length);
    assert.equal(ticket, revenue / orders.length);
  });

  it("pedidos cancelados são excluídos dos indicadores principais", () => {
    assert.equal(isCommercialMetricsSalesOrder("CANCELLED"), false);
    assert.equal(isCommercialMetricsSalesOrder("ERROR"), false);
    assert.equal(isCommercialMetricsSalesOrder("READY_TO_SEND"), true);
    const orders = [
      ...britaniaOrders(),
      {
        id: "so-x",
        orderCode: "PV-X",
        status: "CANCELLED" as SalesOrderLinkStatus,
        issueDate: "2025-03-01T00:00:00.000Z",
        updatedAt: "2025-03-01T00:00:00.000Z",
        totalNetValue: 999999,
        totalMarginPerc: 0,
        hasInvoicing: false,
      },
    ];
    const abc = buildPortfolioAbcFromSalesOrders([{ customerId: BRITANIA_ID, revenue: 212500 }], BRITANIA_ID);
    const intel = computeCommercialPhase2FromSalesOrders(orders, abc);
    assert.ok(intel.trend.recent180dApprovedNet < 999999);
  });

  it("carteira em aberto = pedido válido sem faturamento", () => {
    const open = britaniaOrders()[1]!;
    assert.equal(isCommercialOpenSalesOrder(open), true);
    const invoiced = britaniaOrders()[0]!;
    assert.equal(isCommercialOpenSalesOrder(invoiced), false);
  });

  it("safeCommercialNumber não retorna NaN/Infinity", () => {
    assert.equal(safeCommercialNumber("abc"), 0);
    assert.equal(safeCommercialNumber(Infinity), 0);
    assert.ok(Number.isFinite(computeCustomerSalesOrderTicketAverage(100, 2)));
  });

  it("UI não menciona propostas aprovadas como proxy", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "customers", "CustomerCommercial360.tsx"),
      "utf8"
    );
    assert.equal(modal.includes("Aprovadas como proxy"), false);
    assert.equal(modal.includes("proxy por proposta"), false);
    assert.match(modal, /Histórico de pedidos de venda/);
    assert.match(modal, /COMMERCIAL_SALES_ORDER_BASIS_NOTE/);
  });

  it("endpoint commercial-360 usa SalesOrder", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /salesOrder\.findMany/);
    assert.match(server, /buildPortfolioAbcFromSalesOrders/);
    assert.match(server, /loadOfficialCommercial360MarginBundle/);
    assert.equal(server.includes("proposal.findMany({\n        where: { customerId: id }"), false);
  });

  it("cenário Britania — receita, pedidos, ABC e histórico", () => {
    const orders = britaniaOrders();
    const revenue = orders.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);
    const abc = buildPortfolioAbcFromSalesOrders(
      [{ customerId: BRITANIA_ID, revenue }, { customerId: OTHER_CUSTOMER_ID, revenue: 5000 }],
      BRITANIA_ID
    );
    const intel = computeCommercialPhase2FromSalesOrders(orders, abc);
    assert.ok(revenue > 0);
    assert.equal(orders.length, 2);
    assert.ok(abc.abcClass != null);
    assert.ok(intel.portfolioAbc.customerApprovedNet > 0);
    assert.match(intel.proxyNote, /Pedidos de Venda/i);
  });
});
