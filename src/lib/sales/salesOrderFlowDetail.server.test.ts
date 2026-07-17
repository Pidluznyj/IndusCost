import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadSalesOrderFlowDetail,
  loadSalesOrderFlowEvents,
} from "./salesOrderFlowDetail.server.js";
import type { SalesOrderFlowDetailDb } from "./salesOrderFlowDetail.server.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

function createDb(options?: {
  missingOrder?: boolean;
  missingSnapshot?: boolean;
  customerId?: string;
}) {
  const customerId = options?.customerId ?? CUSTOMER_ID;
  const db = {
    salesOrder: {
      findUnique: async () =>
        options?.missingOrder ? null : { id: ORDER_ID, customerId },
      findMany: async () =>
        options?.missingOrder
          ? []
          : [
              {
                id: ORDER_ID,
                orderCode: "PD 1",
                status: "SENT_TO_NOMUS",
                externalSalesOrderId: 1,
                externalSalesOrderCode: "1",
                issueDate: new Date("2026-06-01T00:00:00Z"),
                expectedDeliveryDate: new Date("2026-07-01T00:00:00Z"),
                totalNetValue: 100,
                totalGrossValue: 100,
                customerId,
                externalSellerId: 10,
                nomusSellerName: "Ana",
                companyIssuer: "Laz",
                externalCompanyId: 1,
                notes: null,
                internalNotes: null,
                responsible: "FATURAMENTO",
                paymentTerms: null,
                paymentMethod: null,
                freightCondition: null,
                deliveryLocation: null,
                Customer: {
                  id: customerId,
                  companyName: "Cliente",
                  tradeName: null,
                  taxId: null,
                },
                items: [
                  {
                    id: ITEM_ID,
                    salesOrderId: ORDER_ID,
                    productId: "p1",
                    externalProductId: 1,
                    nomusItemExternalId: 1,
                    nomusItemSequence: "1",
                    skuSnapshot: "SKU",
                    productNameSnapshot: "Prod",
                    quantity: 1,
                    nomusQuantityFulfilled: null,
                    nomusQuantityPending: null,
                    nomusItemStatusRaw: null,
                    nomusItemStatusNormalized: "RELEASED",
                    nomusIsCanceled: false,
                    nomusIsStale: false,
                    nomusIsCut: false,
                  },
                ],
              },
            ],
    },
    product: { findMany: async () => [] },
    salesOrderNfeLink: { findMany: async () => [] },
    nomusNfe: { findMany: async () => [] },
    nomusProductionOrderSalesLink: { findMany: async () => [] },
    nomusProductionOrder: { findMany: async () => [] },
    orderToCashAuditFact: { findMany: async () => [] },
    nomusStockDocument: { findMany: async () => [] },
    nomusStockDocumentItem: { findMany: async () => [] },
    salesOrderFlowSnapshot: {
      findUnique: async () =>
        options?.missingSnapshot
          ? null
          : {
              salesOrderId: ORDER_ID,
              currentStage: "IN_PRODUCTION",
              bottleneckStage: "IN_PRODUCTION",
              bottleneckSalesOrderItemId: ITEM_ID,
              bottleneckReason: "Sem cobertura de OP",
              nextAction: "Acompanhar OP",
              responsibleArea: "PCP_PRODUCAO",
              totalItems: 1,
              activeItems: 1,
              completedItems: 0,
              pendingItems: 1,
              inconsistentItems: 0,
              canceledItems: 0,
              progressProductionOrder: 0,
              progressProduced: null,
              progressDocumented: 0,
              progressInvoiced: 0,
              progressShipped: 0,
              orderValue: 100,
              fulfilledValue: 0,
              activeResidualValue: 100,
              cutValue: 0,
              canceledValue: 0,
              firstShippedAt: null,
              lastShippedAt: null,
              completedAt: null,
              promisedDeliveryAt: new Date("2026-07-01T00:00:00Z"),
              isOverdue: true,
              isInActiveOperationalColumn: true,
              inconsistenciesJson: [],
              badgesJson: ["OVERDUE"],
              fingerprint: "fp",
              computationVersion: "sales-order-flow/v1",
              computedAt: new Date("2026-07-17T00:00:00Z"),
            },
    },
    salesOrderItemFlowSnapshot: {
      findMany: async () =>
        options?.missingSnapshot
          ? []
          : [
              {
                salesOrderItemId: ITEM_ID,
                salesOrderId: ORDER_ID,
                currentStage: "IN_PRODUCTION",
                fulfillmentClassification: "PENDING",
                orderedQuantity: 1,
                activeRemainingQuantity: 1,
                documentedQuantity: 0,
                invoicedQuantity: 0,
                shippedQuantity: 0,
                cutQuantity: 0,
                canceledQuantity: 0,
                shipTargetQuantity: 1,
                progressProductionOrder: 0,
                progressProduced: null,
                progressDocumented: 0,
                progressInvoiced: 0,
                progressShipped: 0,
                nextAction: "Abrir OP",
                responsibleArea: "PCP_PRODUCAO",
                stageEnteredAt: new Date("2026-07-10T00:00:00Z"),
                promisedDeliveryAt: null,
                isOverdue: true,
                isActiveForKanban: true,
                inconsistenciesJson: [],
                fingerprint: "ifp",
                computationVersion: "sales-order-flow/v1",
                computedAt: new Date("2026-07-17T00:00:00Z"),
              },
            ],
    },
    salesOrderFlowManagement: {
      findUnique: async () => ({
        priority: "HIGH",
        responsibleUserId: null,
        responsibleName: "Gestor",
        responsibleArea: "COMERCIAL",
        isBlocked: true,
        blockReason: "crédito",
        reason: null,
        expectedResolutionAt: null,
        internalNote: "nota",
      }),
    },
    salesOrderFlowEvent: {
      count: async (args: { where: { eventType?: string } }) =>
        args.where.eventType && args.where.eventType !== "STAGE_CHANGED"
          ? 0
          : 1,
      findMany: async (args: {
        where: { eventType?: string };
        skip: number;
        take: number;
      }) => {
        if (args.where.eventType && args.where.eventType !== "STAGE_CHANGED") {
          return [];
        }
        return [
          {
            id: "e1",
            eventType: "STAGE_CHANGED",
            fromStage: "WAITING_PRODUCTION_ORDER",
            toStage: "IN_PRODUCTION",
            salesOrderItemId: ITEM_ID,
            dedupeKey: "d1",
            payloadJson: { note: "ok" },
            actorId: null,
            occurredAt: new Date("2026-07-11T00:00:00Z"),
            observedAt: new Date("2026-07-11T00:00:00Z"),
            createdAt: new Date("2026-07-11T00:00:00Z"),
          },
        ].slice(args.skip, args.skip + args.take);
      },
    },
  } as unknown as SalesOrderFlowDetailDb;

  return db;
}

describe("salesOrderFlowDetail.server (OP-61)", () => {
  it("retorna detalhe completo com snapshot", async () => {
    const result = await loadSalesOrderFlowDetail(ORDER_ID, {
      prisma: createDb(),
      canViewValues: true,
      canViewFiscal: true,
      now: () => new Date("2026-07-17T12:00:00Z"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.snapshotStatus, "READY");
    assert.equal(result.payload.recomputable, false);
    assert.equal(result.payload.orderSnapshot?.currentStage, "IN_PRODUCTION");
    assert.equal(result.payload.itemSnapshots.length, 1);
    assert.equal(result.payload.management?.isBlocked, true);
    assert.equal(result.payload.financialSituation?.orderValue, 100);
    assert.equal(result.payload.valuesVisible, true);
    assert.doesNotMatch(JSON.stringify(result.payload), /rawJson|nomusRaw/);
  });

  it("snapshot ausente retorna estado recomputável (não 500)", async () => {
    const result = await loadSalesOrderFlowDetail(ORDER_ID, {
      prisma: createDb({ missingSnapshot: true }),
      canViewValues: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.snapshotStatus, "SNAPSHOT_MISSING");
    assert.equal(result.payload.recomputable, true);
    assert.equal(result.payload.orderSnapshot, null);
    assert.match(result.payload.message ?? "", /recomputável|rebuild/i);
  });

  it("pedido inexistente retorna 404", async () => {
    const result = await loadSalesOrderFlowDetail(ORDER_ID, {
      prisma: createDb({ missingOrder: true }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });

  it("acesso restrito por carteira retorna 403", async () => {
    const result = await loadSalesOrderFlowDetail(ORDER_ID, {
      prisma: createDb({ customerId: CUSTOMER_ID }),
      scopeCustomerIds: [OTHER_CUSTOMER],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 403);
  });

  it("oculta valores quando canViewValues=false", async () => {
    const result = await loadSalesOrderFlowDetail(ORDER_ID, {
      prisma: createDb(),
      canViewValues: false,
      canViewFiscal: false,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.valuesVisible, false);
    assert.equal(result.payload.financialSituation?.orderValue, null);
    assert.equal(result.payload.orderSnapshot?.orderValue, null);
  });

  it("timeline pagina e filtra eventos", async () => {
    const result = await loadSalesOrderFlowEvents(
      ORDER_ID,
      { page: "0", pageSize: "10", eventType: "STAGE_CHANGED" },
      { prisma: createDb() }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.total, 1);
    assert.equal(result.payload.items[0]?.eventType, "STAGE_CHANGED");
    assert.equal(result.payload.filters.eventType, "STAGE_CHANGED");
  });
});
