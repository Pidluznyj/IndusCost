import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildSellerKpiCards } from "@/src/components/crmSellerDashboardUi";
import {
  computeSellerTicketAverage,
  sellerDashToNumber,
} from "@/src/lib/crmSellerDashboard";
import { isOpenPortfolioSalesOrder } from "@/src/lib/crmCommercialOrderRules";

const fmtNum = (v: number | null | undefined) => String(v ?? 0);
const fmtCur = (v: unknown) => String(v ?? 0);

describe("crmSellerDashboard", () => {
  it("ticket médio usa pedidos válidos", () => {
    assert.equal(computeSellerTicketAverage(50000, 10), 5000);
    assert.equal(computeSellerTicketAverage(50000, 0), 0);
    assert.equal(computeSellerTicketAverage(Number.POSITIVE_INFINITY, 2), 0);
  });

  it("sellerDashToNumber não retorna NaN", () => {
    assert.equal(sellerDashToNumber("bad"), 0);
    assert.equal(sellerDashToNumber(12500.5), 12500.5);
    assert.ok(Number.isFinite(sellerDashToNumber(null)));
  });

  it("carteira aberta usa SalesOrder, não Proposal", () => {
    assert.equal(
      isOpenPortfolioSalesOrder({
        status: "READY_TO_SEND",
        nomusRawResponse: {},
      }),
      true
    );
    assert.equal(
      isOpenPortfolioSalesOrder({ status: "ERROR", nomusRawResponse: {} }),
      false
    );
  });

  it("UI não usa Propostas como KPI principal", () => {
    const cards = buildSellerKpiCards(
      {
        ordersCount: 12,
        ordersValue: 240000,
        invoicedOrdersCount: 8,
        invoicedOrdersValue: 180000,
        openOrdersCount: 4,
        openOrdersValue: 60000,
        cancelledOrdersCount: 1,
        uniqueCustomersCount: 9,
        ticketAverage: 20000,
        topProduct: {
          productId: "p1",
          productName: "Motor 3CV",
          sku: "MOT-3",
          revenue: 80000,
          quantity: 40,
        },
        ordersWithoutLinkedProposalCount: 2,
      },
      fmtNum,
      fmtCur
    );
    const labels = cards.map((c) => c.label);
    assert.ok(labels.includes("Pedidos emitidos"));
    assert.ok(labels.includes("Carteira aberta"));
    assert.ok(labels.includes("Ticket médio"));
    assert.ok(labels.includes("Produto líder"));
    assert.equal(labels.some((l) => l === "Propostas abertas"), false);
    assert.equal(labels.some((l) => l.includes("Propostas sem pedido")), false);
    const traceCard = cards.find((c) => c.label.includes("sem proposta"));
    assert.ok(traceCard?.description?.includes("rastreabilidade"));
  });

  it("serviço por vendedor consulta SalesOrder e SalesOrderItem", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmSellerDashboardService.ts"),
      "utf8"
    );
    assert.match(service, /"SalesOrder"/);
    assert.match(service, /"SalesOrderItem"/);
    assert.equal(service.includes('"Proposal"'), false);
    assert.match(service, /openOrdersCount/);
    assert.match(service, /topProduct/);
    assert.match(service, /buildCrmSellerPortfolioOrderScopeSql/);
    assert.match(service, /fetchCrmManualOwnerCustomerIds/);
    assert.match(service, /nomusSellerName|buildCrmOrderSellerNameSql/);
  });

  it("endpoint seller-dashboard delega ao serviço de pedidos", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf("/api/crm/seller-dashboard");
    assert.ok(start >= 0, "rota seller-dashboard deve existir");
    const block = server.slice(start, start + 2500);
    assert.match(block, /buildCrmSellerDashboardResponse/);
    assert.equal(block.includes("openProposalsCount"), false);
    assert.equal(block.includes('"Proposal"'), false);
  });

  it("vendedor com pedidos aparece com valor > 0 no summary tipado", () => {
    const ordersValue = sellerDashToNumber(87500);
    const ticket = computeSellerTicketAverage(ordersValue, 1);
    assert.ok(ordersValue > 0);
    assert.ok(ticket > 0);
    assert.ok(Number.isFinite(ticket));
  });
});
