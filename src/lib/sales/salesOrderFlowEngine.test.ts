import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { resolveSalesOrderItemFlow } from "./salesOrderItemFlowEngine.js";
import {
  resolveSalesOrderFlow,
  type ResolveSalesOrderFlowOrderContext,
} from "./salesOrderFlowEngine.js";

const ORDER_ID = "order-op51";

function ctx(
  partial: Partial<ResolveSalesOrderFlowOrderContext> = {}
): ResolveSalesOrderFlowOrderContext {
  return {
    salesOrderId: ORDER_ID,
    referenceDate: "2026-07-17T12:00:00.000Z",
    promisedDeliveryAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("salesOrderFlowEngine — consolidação OP-51", () => {
  it("exemplo obrigatório: A enviado, B NF, C produção, D OP → WAITING_PRODUCTION_ORDER", () => {
    const itemA = resolveSalesOrderItemFlow({
      salesOrderItemId: "A",
      status: 4,
      statusNormalized: "FULFILLED",
      orderedQuantity: 10,
      fulfilledQuantity: 10,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "da", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const itemB = resolveSalesOrderItemFlow({
      salesOrderItemId: "B",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 10,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "db", quantity: 10 }],
      // sem NF válida
    });
    const itemC = resolveSalesOrderItemFlow({
      salesOrderItemId: "C",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 10,
      costingMode: "OWN_PROCESS",
      hasProductRouting: true,
      productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
      producedQuantity: 3,
    });
    const itemD = resolveSalesOrderItemFlow({
      salesOrderItemId: "D",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 10,
      costingMode: "OWN_PROCESS",
      hasProductBom: true,
      productionOrderLinks: [],
    });

    assert.equal(itemA.currentStage, "SHIPPED_COMPLETED");
    assert.equal(itemB.currentStage, "WAITING_NFE");
    assert.equal(itemC.currentStage, "IN_PRODUCTION");
    assert.equal(itemD.currentStage, "WAITING_PRODUCTION_ORDER");

    const order = resolveSalesOrderFlow([itemA, itemB, itemC, itemD], ctx({
      itemFinancials: [
        { salesOrderItemId: "A", plannedNetValue: 100 },
        { salesOrderItemId: "B", plannedNetValue: 100 },
        { salesOrderItemId: "C", plannedNetValue: 100 },
        { salesOrderItemId: "D", plannedNetValue: 100 },
      ],
    }));

    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(order.currentBottleneck?.salesOrderItemId, "D");
    assert.equal(order.responsibleArea, "PCP_PRODUCAO");
    assert.equal(order.pendingItems, 3);
    assert.equal(order.completedItems, 1);
    assert.equal(order.totalItems, 4);
    assert.equal(order.isInActiveOperationalColumn, true);
    assert.ok(order.badges.includes("MIXED_STAGES"));
    assert.ok(
      order.inconsistencies.some((i) => i.code === "MIXED_ACTIVE_ITEM_STAGES")
    );
  });

  it("pedido cancelado fica fora das colunas operacionais ativas", () => {
    const item = resolveSalesOrderItemFlow({
      salesOrderItemId: "x",
      status: 6,
      statusNormalized: "CANCELED",
      orderedQuantity: 5,
      nomusIsCanceled: true,
    });
    const order = resolveSalesOrderFlow([item], ctx({
      orderStatus: "CANCELLED",
      itemFinancials: [{ salesOrderItemId: "x", plannedNetValue: "50.00" }],
    }));
    assert.equal(order.currentStage, "CANCELED");
    assert.equal(order.isInActiveOperationalColumn, false);
    assert.ok(order.badges.includes("OUT_OF_ACTIVE_COLUMNS"));
    assert.equal(order.canceledValue.eq(50), true);
  });

  it("todos itens cancelados → CANCELED", () => {
    const items = ["a", "b"].map((id) =>
      resolveSalesOrderItemFlow({
        salesOrderItemId: id,
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 1,
        nomusIsCanceled: true,
      })
    );
    const order = resolveSalesOrderFlow(items, ctx());
    assert.equal(order.currentStage, "CANCELED");
    assert.equal(order.activeItems, 0);
    assert.equal(order.isInActiveOperationalColumn, false);
  });

  it("pedido com corte conclui quando obrigação ativa zerada e atendido com Doc+NF", () => {
    const cut = resolveSalesOrderItemFlow({
      salesOrderItemId: "cut",
      status: 5,
      statusNormalized: "FULFILLED_WITH_CUT",
      orderedQuantity: 10,
      fulfilledQuantity: 6,
      productCommercialClass: "MANUFACTURED",
      productionOrderLinks: [{ linkedQuantity: 6, isCurrent: true }],
      documentAllocations: [{ allocationKey: "d", quantity: 6 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 6,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    assert.equal(cut.currentStage, "SHIPPED_COMPLETED");
    assert.equal(cut.cutQuantity.eq(4), true);

    const order = resolveSalesOrderFlow([cut], ctx({
      itemFinancials: [{ salesOrderItemId: "cut", plannedNetValue: 100 }],
      itemShippedAt: [
        { salesOrderItemId: "cut", shippedAt: "2026-07-10T10:00:00.000Z" },
      ],
    }));
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.equal(order.cutValue.eq(40), true);
    assert.equal(order.activeResidualValue.eq(0), true);
    assert.equal(order.completedAt, "2026-07-10T10:00:00.000Z");
    assert.ok(order.badges.includes("CUT"));
    assert.ok(order.badges.includes("COMPLETED"));
  });

  it("retorno de etapa: item regride e pedido acompanha a primeira obrigação", () => {
    const shipped = resolveSalesOrderItemFlow({
      salesOrderItemId: "ok",
      status: 4,
      statusNormalized: "FULFILLED",
      orderedQuantity: 5,
      fulfilledQuantity: 5,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d1", quantity: 5 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 5,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });

    const withValidNf = resolveSalesOrderItemFlow({
      salesOrderItemId: "reg",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 5,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d2", quantity: 5 }],
      nfeAllocations: [
        {
          nfeExternalId: 2,
          quantity: 5,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const before = resolveSalesOrderFlow([shipped, withValidNf], ctx());
    assert.equal(before.currentStage, "SHIPPED_COMPLETED");

    // Regressão: NF cancelada no segundo item
    const afterNfCancel = resolveSalesOrderItemFlow({
      salesOrderItemId: "reg",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 5,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d2", quantity: 5 }],
      nfeAllocations: [
        {
          nfeExternalId: 2,
          quantity: 5,
          isCanceled: true,
          isValidForBilling: false,
          hasDocument: true,
        },
      ],
    });
    const after = resolveSalesOrderFlow([shipped, afterNfCancel], ctx());
    assert.equal(after.currentStage, "WAITING_NFE");
    assert.equal(after.currentBottleneck?.salesOrderItemId, "reg");
    assert.notEqual(after.currentStage, before.currentStage);
  });

  it("consolida valores monetários e progressos com Decimal", () => {
    const pending = resolveSalesOrderItemFlow({
      salesOrderItemId: "p",
      status: 1,
      statusNormalized: "PENDING",
      orderedQuantity: 10,
    });
    const partial = resolveSalesOrderItemFlow({
      salesOrderItemId: "q",
      status: 3,
      statusNormalized: "PARTIAL",
      orderedQuantity: 10,
      fulfilledQuantity: 4,
      productCommercialClass: "RESALE",
    });
    const order = resolveSalesOrderFlow([pending, partial], ctx({
      itemFinancials: [
        { salesOrderItemId: "p", plannedNetValue: "100.00" },
        { salesOrderItemId: "q", plannedNetValue: "100.00" },
      ],
      promisedDeliveryAt: "2026-01-01T00:00:00.000Z",
    }));

    assert.ok(order.orderValue instanceof Prisma.Decimal);
    assert.equal(order.orderValue.eq(200), true);
    assert.equal(order.activeResidualValue.eq(160), true); // 100 + 60
    assert.equal(order.fulfilledValue.eq(40), true);
    assert.equal(order.isOverdue, true);
    assert.ok(order.badges.includes("OVERDUE"));
    assert.ok(order.badges.includes("PARTIAL"));
    assert.ok(order.progress.documented instanceof Prisma.Decimal);
  });

  it("first/last shipped a partir do contexto", () => {
    const a = resolveSalesOrderItemFlow({
      salesOrderItemId: "a",
      status: 4,
      statusNormalized: "FULFILLED",
      orderedQuantity: 1,
      fulfilledQuantity: 1,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d", quantity: 1 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 1,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const b = resolveSalesOrderItemFlow({
      salesOrderItemId: "b",
      status: 4,
      statusNormalized: "FULFILLED",
      orderedQuantity: 1,
      fulfilledQuantity: 1,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d2", quantity: 1 }],
      nfeAllocations: [
        {
          nfeExternalId: 2,
          quantity: 1,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const order = resolveSalesOrderFlow([a, b], ctx({
      itemShippedAt: [
        { salesOrderItemId: "b", shippedAt: "2026-07-05T00:00:00.000Z" },
        { salesOrderItemId: "a", shippedAt: "2026-07-01T00:00:00.000Z" },
      ],
    }));
    assert.equal(order.firstShippedAt, "2026-07-01T00:00:00.000Z");
    assert.equal(order.lastShippedAt, "2026-07-05T00:00:00.000Z");
    assert.equal(order.completedAt, "2026-07-05T00:00:00.000Z");
  });

  it("lista vazia → CANCELED fora das colunas ativas", () => {
    const order = resolveSalesOrderFlow([], ctx());
    assert.equal(order.currentStage, "CANCELED");
    assert.equal(order.isInActiveOperationalColumn, false);
    assert.equal(order.totalItems, 0);
  });

  it("usa apenas estágios dos itens ativos na votação (cancelado não puxa)", () => {
    const canceled = resolveSalesOrderItemFlow({
      salesOrderItemId: "c",
      status: 6,
      statusNormalized: "CANCELED",
      orderedQuantity: 1,
      nomusIsCanceled: true,
    });
    const waitingNf = resolveSalesOrderItemFlow({
      salesOrderItemId: "w",
      status: 2,
      statusNormalized: "RELEASED",
      orderedQuantity: 2,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d", quantity: 2 }],
    });
    // Se cancelado votasse WAITING_RELEASE errado; deve ser WAITING_NFE
    const order = resolveSalesOrderFlow([canceled, waitingNf], ctx());
    assert.equal(order.currentStage, "WAITING_NFE");
    assert.equal(order.activeItems, 1);
  });
});
