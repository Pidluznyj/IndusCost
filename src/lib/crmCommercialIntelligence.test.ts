import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCrmCommercialIntelligenceResponse,
  orderHasFollowUpAfterUpdate,
} from "./crmCommercialIntelligence.js";
import type { CrmCommercialOrderRow } from "./crmCommercialIntelligence.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-06-12T12:00:00.000Z");

function baseCustomer() {
  return {
    id: CUSTOMER_ID,
    companyName: "Britânia Eletrodomésticos SA",
    tradeName: "Britânia",
    taxId: "12.345.678/0001-90",
  };
}

function openOrder(overrides?: Partial<CrmCommercialOrderRow>): CrmCommercialOrderRow {
  return {
    id: "so-open-1",
    orderCode: "PV-2001",
    issueDate: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    status: "READY_TO_SEND",
    totalNetValue: 87500,
    responsible: "Carlos",
    expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    nomusRawResponse: { nfes: [] },
    ...overrides,
  };
}

function purchaseOrder(overrides?: Partial<CrmCommercialOrderRow>): CrmCommercialOrderRow {
  return {
    id: "so-purchase-1",
    orderCode: "PV-1001",
    issueDate: new Date("2026-05-15T00:00:00.000Z"),
    updatedAt: new Date("2026-05-16T00:00:00.000Z"),
    status: "SENT_TO_NOMUS",
    totalNetValue: 125000,
    responsible: "Carlos",
    nomusRawResponse: { nfes: [{ dataProcessamento: "16/05/2026" }] },
    ...overrides,
  };
}

describe("crmCommercialIntelligence", () => {
  it("cliente com pedidos e sem propostas tem cockpit preenchido", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder(), purchaseOrder()],
      negotiationProposals: [],
      now: NOW,
    });
    assert.ok(res.openOrders.openOrdersCount > 0);
    assert.ok(res.openOrders.openOrdersValue > 0);
    assert.ok(res.openOrders.latestOrders.length > 0);
    assert.equal(res.proposals, undefined);
  });

  it("receita/histórico principal vêm de SalesOrder", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [purchaseOrder()],
      now: NOW,
    });
    assert.ok(res.orders.totalPurchasedLast12Months > 0);
    assert.equal(res.orders.lastOrder?.orderCode, "PV-1001");
    assert.equal(res.summary.hasPurchaseHistory, true);
  });

  it("últimos pedidos substituem últimas propostas no bloco openOrders", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder(), purchaseOrder()],
      now: NOW,
    });
    assert.ok(res.openOrders.latestOrders.length >= 1);
    assert.ok(res.openOrders.latestOrders.some((o) => o.orderCode === "PV-2001"));
  });

  it("carteira aberta usa pedidos válidos sem NF processada", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder(), purchaseOrder()],
      now: NOW,
    });
    assert.equal(res.openOrders.openOrdersCount, 1);
    assert.equal(res.openOrders.latestOpenOrders[0]?.orderCode, "PV-2001");
  });

  it("pedidos cancelados/erro não entram em carteira aberta", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [
        openOrder({ id: "x1", status: "CANCELLED" }),
        openOrder({ id: "x2", status: "ERROR" }),
        openOrder({ id: "x3", status: "READY_TO_SEND" }),
      ],
      now: NOW,
    });
    assert.equal(res.openOrders.openOrdersCount, 1);
  });

  it("pedidos sem follow-up usam salesOrderId com fallback por cliente", () => {
    const order = openOrder();
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [order],
      now: NOW,
    });
    assert.equal(res.openOrders.ordersWithoutFollowUpCount, 1);
    assert.equal(orderHasFollowUpAfterUpdate(order.id, order.updatedAt, []), false);
    assert.equal(
      orderHasFollowUpAfterUpdate(order.id, order.updatedAt, [
        {
          contactDate: new Date("2026-05-03T00:00:00.000Z"),
          createdAt: new Date("2026-05-03T00:00:00.000Z"),
          salesOrderId: order.id,
        },
      ]),
      true
    );
    const withFollowUp = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [
        {
          contactDate: new Date("2026-05-03T00:00:00.000Z"),
          createdAt: new Date("2026-05-03T00:00:00.000Z"),
          salesOrderId: order.id,
        },
      ],
      salesOrders: [order],
      now: NOW,
    });
    assert.equal(withFollowUp.openOrders.ordersWithoutFollowUpCount, 0);
  });

  it("summary.hasOpenOrders funciona", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder()],
      now: NOW,
    });
    assert.equal(res.summary.hasOpenOrders, true);
    assert.equal(res.summary.hasOrderWithoutFollowUp, true);
  });

  it("summary.hasOpenProposals deixa de ser sinal principal", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder()],
      negotiationProposals: [
        {
          id: "p1",
          number: 99,
          title: "Orçamento",
          status: "SENT",
          totalNetValue: 50000,
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          responsible: "Ana",
        },
      ],
      now: NOW,
    });
    assert.equal(res.summary.hasOpenProposals, false);
    assert.equal(res.summary.hasOpenOrders, true);
    assert.ok(res.proposals?.negotiationCount === 1);
    assert.ok(!res.signals.some((s) => s.title.toLowerCase().includes("proposta")));
  });

  it("nextSuggestedAction prioriza pedidos", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder()],
      now: NOW,
    });
    assert.match(res.summary.nextSuggestedAction, /pedido em carteira/i);
  });

  it("textos da UI não usam proposta como base principal", () => {
    const ui = readFileSync(join(process.cwd(), "src", "components", "CrmModule.tsx"), "utf8");
    assert.match(ui, /Pedidos em carteira/);
    assert.match(ui, /Pedidos, carteira e sinais comerciais/);
    assert.match(ui, /openOrders/);
    assert.equal(ui.includes("Compras, propostas e sinais comerciais"), false);
    assert.equal(ui.includes("Propostas abertas"), false);
  });

  it("propostas aparecem só como pré-venda auxiliar quando existem", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [],
      negotiationProposals: [
        {
          id: "p1",
          number: 1,
          title: "Negociação",
          status: "ANALYSIS",
          totalNetValue: 1000,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          responsible: null,
        },
      ],
      now: NOW,
    });
    assert.equal(res.proposals?._deprecated, true);
    assert.equal(res.proposals?.latestNegotiationProposals.length, 1);
    assert.equal(res.summary.hasOpenOrders, false);
  });

  it("não retorna NaN/Infinity", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder({ totalNetValue: "bad" })],
      now: NOW,
    });
    assert.ok(Number.isFinite(res.openOrders.openOrdersValue));
    assert.ok(Number.isFinite(res.orders.totalPurchasedLast12Months));
    for (const o of res.openOrders.latestOrders) {
      assert.ok(Number.isFinite(o.totalNetValue));
    }
  });

  it("cenário obrigatório: SalesOrder válido, zero Proposal", () => {
    const res = buildCrmCommercialIntelligenceResponse({
      customer: baseCustomer(),
      activities: [],
      salesOrders: [openOrder()],
      negotiationProposals: [],
      now: NOW,
    });
    assert.ok(res.openOrders.openOrdersCount > 0);
    assert.ok(res.openOrders.openOrdersValue > 0);
    assert.ok(res.openOrders.latestOrders.length > 0);
    assert.equal(res.summary.hasOpenOrders, true);
    assert.ok(res.signals.some((s) => s.title.includes("carteira")));
  });

  it("endpoint commercial-intelligence usa buildCrmCommercialIntelligenceResponse", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /buildCrmCommercialIntelligenceResponse/);
    assert.match(server, /salesOrder\.findMany/);
    const block = server.slice(
      server.indexOf('app.get("/api/crm/customers/:customerId/commercial-intelligence"'),
      server.indexOf('app.put("/api/crm/customers/:customerId/profile"')
    );
    assert.equal(block.includes("openProposalsCount"), false);
  });
});
