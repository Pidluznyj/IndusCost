/**
 * OP-03 — Precedência: envio/conclusão prevalece sobre ausência de OP.
 * Inclui regressão do caso PD 02596 (fixture sintética — sem orderCode em produção).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
} from "./salesOrderFlowFingerprint.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";

const D = (v: string | number) => new Prisma.Decimal(v);

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

/** Fixture sintética alinhada ao item FULFILLED do PD 02596 (sem orderCode). */
function pd02596CompletedManufacturedItem(
  salesOrderItemId: string,
  overrides: Partial<ResolveSalesOrderItemFlowInput> = {}
): ResolveSalesOrderItemFlowInput {
  return base({
    salesOrderItemId,
    status: 4,
    statusNormalized: "FULFILLED",
    orderedQuantity: 1000,
    fulfilledQuantity: 1000,
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    productionOrderLinks: [],
    documentAllocations: [{ allocationKey: `doc-${salesOrderItemId}`, quantity: 1000 }],
    nfeAllocations: [
      {
        nfeExternalId: 7292,
        quantity: 1000,
        isValidForBilling: true,
        hasDocument: true,
        hasShipDate: false,
      },
    ],
    ...overrides,
  });
}

describe("salesOrderFlowCompletionPrecedence (OP-03)", () => {
  it("1) exige produção, sem OP, ainda não enviado → WAITING_PRODUCTION_ORDER", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
      })
    );
    assert.equal(r.requiresProduction, true);
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(r.responsibleArea, "PCP_PRODUCAO");
    assert.match(r.nextAction, /Ordem de Produção/i);
  });

  it("2) exige produção, sem OP, parcialmente enviado com saldo ativo → operacional", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 400,
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
        documentAllocations: [{ allocationKey: "d-partial", quantity: 400 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 400,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.requiresProduction, true);
    assert.ok(r.shipTargetQuantity.gt(0));
    assert.ok(r.shippedQuantity.lt(r.shipTargetQuantity));
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("3) exige produção, sem OP, totalmente enviado sem saldo ativo → SHIPPED_COMPLETED", () => {
    const r = resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("i1"));
    assert.equal(r.requiresProduction, true);
    assert.equal(r.productionRequirement.requiresProduction, true);
    assert.equal(r.productionOrderQuantity.eq(0), true);
    assert.equal(r.activeRemainingQuantity?.eq(0), true);
    assert.equal(r.shipTargetQuantity.eq(1000), true);
    assert.equal(r.documentedQuantity.eq(1000), true);
    assert.equal(r.invoicedQuantity.eq(1000), true);
    assert.equal(r.shippedQuantity.eq(1000), true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.responsibleArea, "NENHUMA");
    assert.match(r.nextAction, /Nenhuma ação operacional/i);
  });

  it("4) item totalmente enviado não é rebaixado por ausência de OP", () => {
    const r = resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("i2"));
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.doesNotMatch(r.nextAction, /Abrir ou vincular Ordem de Produção/i);
    assert.match(r.stageReason, /ausência histórica de OP/i);
  });

  it("5) corte válido com obrigação encerrada → SHIPPED_COMPLETED", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 1000,
        fulfilledQuantity: 800,
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
        documentAllocations: [{ allocationKey: "d-cut", quantity: 800 }],
        nfeAllocations: [
          {
            nfeExternalId: 2,
            quantity: 800,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.fulfillment.classification, "FULFILLED_WITH_CUT");
    assert.equal(r.shipTargetQuantity.eq(800), true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("6) item cancelado segue a regra atual", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 1000,
        fulfilledQuantity: 0,
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
      })
    );
    assert.equal(r.currentStage, "CANCELED");
    assert.equal(r.isActiveForKanban, false);
  });

  it("7–8) NFE_SHIP_DATE_MISSING permanece INFO e não bloqueia conclusão", () => {
    const r = resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("i3"));
    const shipDate = r.inconsistencies.find(
      (i) => i.code === "NFE_SHIP_DATE_MISSING"
    );
    assert.ok(shipDate);
    assert.equal(shipDate!.severity, "INFO");
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("9–11) regressão PD 02596: cinco itens encerrados consolidam SHIPPED_COMPLETED sem MIXED/OP", () => {
    const items = [
      resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("a")),
      resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("b")),
      resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("c")),
      resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("d")),
      resolveSalesOrderItemFlow(
        base({
          salesOrderItemId: "e-cut",
          status: 5,
          statusNormalized: "FULFILLED_WITH_CUT",
          orderedQuantity: 1000,
          fulfilledQuantity: 700,
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          productionOrderLinks: [],
          documentAllocations: [{ allocationKey: "d-e", quantity: 700 }],
          nfeAllocations: [
            {
              nfeExternalId: 7292,
              quantity: 700,
              isValidForBilling: true,
              hasDocument: true,
              hasShipDate: false,
            },
          ],
        })
      ),
    ];

    for (const item of items) {
      assert.equal(
        item.currentStage,
        "SHIPPED_COMPLETED",
        `item ${item.salesOrderItemId}`
      );
    }

    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "b48f648a-4ebf-43f0-8fea-691c2edf694a",
      referenceDate: "2026-07-17T12:00:00.000Z",
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });

    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(
      order.currentBottleneck?.stage,
      "WAITING_PRODUCTION_ORDER"
    );
    assert.equal(order.currentBottleneck?.stage, "SHIPPED_COMPLETED");
    assert.doesNotMatch(order.nextAction, /Ordem de Produção/i);
    assert.equal(
      order.inconsistencies.some((i) => i.code === "MIXED_ACTIVE_ITEM_STAGES"),
      false
    );
    assert.ok(order.badges.includes("COMPLETED"));
  });

  it("12) pedido realmente pendente de OP permanece WAITING_PRODUCTION_ORDER", () => {
    const pending = resolveSalesOrderItemFlow(
      base({
        salesOrderItemId: "pending-op",
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
      })
    );
    const order = resolveSalesOrderFlow([pending], {
      salesOrderId: "order-pending-op",
      itemFinancials: [
        { salesOrderItemId: "pending-op", plannedNetValue: 50 },
      ],
    });
    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(order.currentBottleneck?.stage, "WAITING_PRODUCTION_ORDER");
  });

  it("13) fingerprint muda deterministicamente após a correção de estágio", () => {
    const completed = resolveSalesOrderItemFlow(
      pd02596CompletedManufacturedItem("fp")
    );
    assert.equal(completed.currentStage, "SHIPPED_COMPLETED");
    const fpCompleted = buildSalesOrderItemFlowFingerprint(completed);

    // Mesmas quantidades, mas se o estágio fosse WAITING_PRODUCTION_ORDER o FP seria outro.
    const waitingShape = {
      ...completed,
      currentStage: "WAITING_PRODUCTION_ORDER" as const,
      stageReason: "synthetic",
      nextAction: "Abrir ou vincular Ordem de Produção aos itens liberados.",
      responsibleArea: "PCP_PRODUCAO" as const,
    };
    const fpWaiting = buildSalesOrderItemFlowFingerprint(waitingShape);
    assert.notEqual(fpCompleted, fpWaiting);

    const again = resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("fp"));
    assert.equal(buildSalesOrderItemFlowFingerprint(again), fpCompleted);
  });

  it("14–15) recompute draft idempotente e sem evento duplicado no plano fingerprint_match", () => {
    const item = resolveSalesOrderItemFlow(pd02596CompletedManufacturedItem("rc"));
    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "order-rc",
      itemFinancials: [{ salesOrderItemId: "rc", plannedNetValue: D(10) }],
    });
    const draft = buildSalesOrderFlowRecomputeDraft({
      salesOrderId: order.salesOrderId,
      orderResult: order,
      itemResults: [item],
      existingItems: [],
    });
    const itemFp = draft.itemFingerprints.get(item.salesOrderItemId)!;
    const plan = planSalesOrderFlowRecompute({
      draft,
      existingOrder: {
        currentStage: order.currentStage,
        fingerprint: draft.orderFingerprint,
      },
      existingItems: [
        {
          salesOrderItemId: item.salesOrderItemId,
          fingerprint: itemFp,
          currentStage: item.currentStage,
          stageEnteredAt: null,
        },
      ],
    });
    assert.equal(plan.reason, "fingerprint_match");
    assert.equal(plan.action, "unchanged");

    const fpOrder = buildSalesOrderFlowFingerprint(order, [itemFp]);
    assert.equal(fpOrder, draft.orderFingerprint);
  });

  it("16) motor puro não muta estruturas oficiais (somente deriva estágio)", () => {
    const input = pd02596CompletedManufacturedItem("pure");
    const frozen = JSON.stringify(input);
    resolveSalesOrderItemFlow(input);
    assert.equal(JSON.stringify(input), frozen);
  });
});
