/**
 * OP-06 — Atendimento sem produção antes de exigir OP.
 * Regressão PD 02049 (fixture sintética) + pedidos mistos.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";

function base(
  partial: Partial<ResolveSalesOrderItemFlowInput> & {
    salesOrderItemId?: string;
  } = {}
): ResolveSalesOrderItemFlowInput {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-1",
    orderedQuantity: partial.orderedQuantity ?? 10,
    fulfilledQuantity: partial.fulfilledQuantity ?? 0,
    status: partial.status ?? 2,
    statusNormalized: partial.statusNormalized ?? "RELEASED",
    ...partial,
  };
}

/** Fixture alinhada ao PD 02049: 100% atendido, produzido 0, sem OP, doc/NF/envio 100%. */
function pd02049Item(
  salesOrderItemId: string,
  overrides: Partial<ResolveSalesOrderItemFlowInput> = {}
): ResolveSalesOrderItemFlowInput {
  return base({
    salesOrderItemId,
    status: 4,
    statusNormalized: "FULFILLED",
    orderedQuantity: 100,
    fulfilledQuantity: 100,
    producedQuantity: 0,
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    productionOrderLinks: [],
    documentAllocations: [
      { allocationKey: `doc-${salesOrderItemId}`, quantity: 100 },
    ],
    nfeAllocations: [
      {
        nfeExternalId: 2049,
        quantity: 100,
        isValidForBilling: true,
        hasDocument: true,
        hasShipDate: true,
      },
    ],
    ...overrides,
  });
}

function manufacturedNeedingOp(
  salesOrderItemId: string,
  overrides: Partial<ResolveSalesOrderItemFlowInput> = {}
): ResolveSalesOrderItemFlowInput {
  return base({
    salesOrderItemId,
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    productionOrderLinks: [],
    ...overrides,
  });
}

describe("salesOrderFlowFulfilledWithoutProduction (OP-06)", () => {
  it("PD 02049: 100% documentado/faturado/enviado sem OP → SHIPPED_COMPLETED (nunca WAITING_PRODUCTION_ORDER)", () => {
    const item = resolveSalesOrderItemFlow(pd02049Item("pd2049-a"));
    assert.equal(item.requiresProduction, true);
    assert.equal(item.producedQuantity?.eq(0), true);
    assert.equal(item.productionOrderQuantity.eq(0), true);
    assert.equal(item.activeObligationQuantity.eq(100), true);
    assert.equal(item.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(item.fulfilledWithoutProduction, true);
    assert.equal(item.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(item.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.ok(
      item.inconsistencies.some((i) => i.code === "FULFILLED_WITHOUT_PRODUCTION")
    );
    assert.match(
      item.inconsistencies.find((i) => i.code === "FULFILLED_WITHOUT_PRODUCTION")!
        .detail,
      /Atendido pelo estoque \/ sem necessidade de OP/
    );
    assert.doesNotMatch(item.nextAction, /Ordem de Produção/i);

    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "order-pd-02049",
      itemFinancials: [{ salesOrderItemId: "pd2049-a", plannedNetValue: 1000 }],
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(order.currentBottleneck?.stage, "WAITING_PRODUCTION_ORDER");
  });

  it("fulfilledQuantity >= activeObligation sem documento → WAITING_OUTPUT_DOCUMENT (não OP)", () => {
    const r = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("stock-full", {
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 50,
        fulfilledQuantity: 50,
        producedQuantity: 0,
        productionOrderLinks: [],
        documentAllocations: [],
        nfeAllocations: [],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.equal(r.fulfilledWithoutProduction, true);
    assert.match(r.stageReason, /Atendido pelo estoque/);
  });

  it("parcialmente atendido sem OP → WAITING_PRODUCTION_ORDER só pelo residual", () => {
    const r = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("partial-stock", {
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 100,
        fulfilledQuantity: 40,
        productionOrderLinks: [],
        documentAllocations: [{ allocationKey: "d", quantity: 40 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 40,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(60), true);
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(r.fulfilledWithoutProduction, false);
  });

  it("OP cobrindo somente o saldo residual libera WAITING_PRODUCTION_ORDER", () => {
    const r = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("op-residual", {
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 100,
        fulfilledQuantity: 40,
        productionOrderLinks: [{ linkedQuantity: 60, isCurrent: true }],
        documentAllocations: [{ allocationKey: "d", quantity: 40 }],
        nfeAllocations: [
          {
            nfeExternalId: 2,
            quantity: 40,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(60), true);
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("pedido misto: item atendido sem OP + item com saldo sem OP → gargalo no pendente", () => {
    const fulfilled = resolveSalesOrderItemFlow(pd02049Item("ok"));
    const pending = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("pending", {
        orderedQuantity: 20,
        fulfilledQuantity: 0,
      })
    );
    assert.equal(fulfilled.currentStage, "SHIPPED_COMPLETED");
    assert.equal(pending.currentStage, "WAITING_PRODUCTION_ORDER");

    const order = resolveSalesOrderFlow([fulfilled, pending], {
      salesOrderId: "order-mixed",
      itemFinancials: [
        { salesOrderItemId: "ok", plannedNetValue: 100 },
        { salesOrderItemId: "pending", plannedNetValue: 50 },
      ],
    });
    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(order.currentBottleneck?.stage, "WAITING_PRODUCTION_ORDER");
    assert.equal(order.currentBottleneck?.salesOrderItemId, "pending");
  });

  it("item cancelado / cortado não exige OP", () => {
    const canceled = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("cxl", {
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      })
    );
    assert.equal(canceled.currentStage, "CANCELED");
    assert.equal(canceled.remainingFulfillmentQuantity.eq(0), true);

    const cut = resolveSalesOrderItemFlow(
      manufacturedNeedingOp("cut", {
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 100,
        fulfilledQuantity: 70,
        productionOrderLinks: [],
        documentAllocations: [{ allocationKey: "dc", quantity: 70 }],
        nfeAllocations: [
          {
            nfeExternalId: 3,
            quantity: 70,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(cut.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(cut.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(cut.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("pedido integralmente enviado sem nenhuma OP → SHIPPED_COMPLETED", () => {
    const items = [
      resolveSalesOrderItemFlow(pd02049Item("a")),
      resolveSalesOrderItemFlow(pd02049Item("b")),
    ];
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-all-stock",
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(order.currentBottleneck?.stage, "WAITING_PRODUCTION_ORDER");
    assert.doesNotMatch(order.nextAction, /Ordem de Produção/i);
  });
});
