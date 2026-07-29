import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";

const D = (v: string | number) => new Prisma.Decimal(v);

function base(
  partial: Partial<ResolveSalesOrderItemFlowInput> & { salesOrderItemId?: string }
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

describe("salesOrderItemFlowEngine — matriz OP-50", () => {
  it("item não atendido (PENDING) → WAITING_RELEASE com obrigação integral", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 1,
        statusNormalized: "PENDING",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      })
    );
    assert.equal(r.currentStage, "WAITING_RELEASE");
    assert.equal(r.activeRemainingQuantity?.eq(10), true);
    assert.equal(r.shipTargetQuantity.eq(10), true);
    assert.equal(r.responsibleArea, "COMERCIAL");
    assert.ok(r.nextAction.length > 0);
    assert.equal(r.isActiveForKanban, true);
  });

  it("item parcialmente atendido mantém saldo ativo", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: "10",
        fulfilledQuantity: "4",
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [{ linkedQuantity: "10", isCurrent: true }],
        documentAllocations: [
          { allocationKey: "d1", quantity: "4" },
        ],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: "4",
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.activeRemainingQuantity?.eq(6), true);
    assert.equal(r.shipTargetQuantity.eq(10), true);
    // restante ainda precisa doc/NF para a obrigação total, ou produção já coberta
    assert.ok(
      r.currentStage === "WAITING_OUTPUT_DOCUMENT" ||
        r.currentStage === "WAITING_NFE" ||
        r.currentStage === "IN_PRODUCTION" ||
        r.currentStage === "WAITING_PRODUCTION_ORDER" ||
        r.currentStage === "SHIPPED_COMPLETED"
    );
    // com OP 10, doc 4, NF 4 → falta documentar o restante 6
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.equal(r.progress.documented.eq(40), true); // 4/10 * 100
  });

  it("item atendido com corte encerra saldo e corta quantidade", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 10,
        fulfilledQuantity: 7,
        productCommercialClass: "MANUFACTURED",
        productionOrderLinks: [{ linkedQuantity: 7, isCurrent: true }],
        documentAllocations: [{ allocationKey: "d1", quantity: 7 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 7,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    assert.equal(r.activeRemainingQuantity?.eq(0), true);
    assert.equal(r.cutQuantity.eq(3), true);
    assert.equal(r.shipTargetQuantity.eq(7), true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("item cancelado não mantém obrigação", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
        nomusIsCanceled: true,
      })
    );
    assert.equal(r.currentStage, "CANCELED");
    assert.equal(r.canceledQuantity.eq(10), true);
    assert.equal(r.shipTargetQuantity.eq(0), true);
    assert.equal(r.isActiveForKanban, false);
    assert.equal(r.responsibleArea, "NENHUMA");
  });

  it("UNKNOWN preserva saldo e gera alerta; não conclui como enviado", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 99,
        statusNormalized: "UNKNOWN",
        orderedQuantity: 8,
        fulfilledQuantity: 2,
      })
    );
    assert.equal(r.fulfillment.classification, "UNKNOWN");
    assert.equal(r.activeRemainingQuantity?.eq(6), true);
    assert.ok(r.inconsistencies.some((i) => i.code === "ITEM_STATUS_UNKNOWN"));
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.currentStage, "WAITING_RELEASE");
  });

  it("produto sem produção comprovada (revenda) pula OP e produção", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 2,
        statusNormalized: "RELEASED",
        orderedQuantity: 5,
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 5 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 5,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.requiresProduction, false);
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.notEqual(r.currentStage, "IN_PRODUCTION");
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("liberado com OWN_PROCESS sem OP → WAITING_PRODUCTION_ORDER", () => {
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
  });

  it("OP parcial → WAITING_PRODUCTION_ORDER; OP total + produced insuficiente → IN_PRODUCTION", () => {
    const waiting = resolveSalesOrderItemFlow(
      base({
        costingMode: "OWN_PROCESS",
        hasProductBom: true,
        productionOrderLinks: [{ linkedQuantity: 3, isCurrent: true }],
      })
    );
    assert.equal(waiting.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(waiting.productionOrderQuantity.eq(3), true);

    const inProd = resolveSalesOrderItemFlow(
      base({
        costingMode: "OWN_PROCESS",
        hasProductBom: true,
        productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
        producedQuantity: 4,
      })
    );
    assert.equal(inProd.currentStage, "IN_PRODUCTION");
  });

  it("Documento cancelado não cobre", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "RESALE",
        documentAllocations: [
          { allocationKey: "d1", quantity: 10, isCanceled: true },
        ],
      })
    );
    assert.equal(r.documentedQuantity.eq(0), true);
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("NF cancelada não cobre nem representa envio", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 7,
            quantity: 10,
            isCanceled: true,
            isValidForBilling: false,
            hasDocument: true,
          },
        ],
      })
    );
    assert.equal(r.invoicedQuantity.eq(0), true);
    assert.equal(r.shippedQuantity.eq(0), true);
    assert.equal(r.currentStage, "WAITING_NFE");
    assert.ok(
      r.inconsistencies.some((i) => i.code === "NFE_CANCELED_WITH_ACTIVE_ITEMS")
    );
  });

  it("NF válida define envio (proxy) → SHIPPED_COMPLETED + NFE_SHIP_DATE_MISSING", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "STOCK",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 4,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      })
    );
    assert.equal(r.shippedQuantity.eq(10), true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.ok(r.inconsistencies.some((i) => i.code === "NFE_SHIP_DATE_MISSING"));
  });

  it("progressos limitados a 100% mesmo com excesso", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "RESALE",
        orderedQuantity: 10,
        documentAllocations: [{ allocationKey: "d1", quantity: 15 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 15,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    assert.equal(r.progress.documented.eq(100), true);
    assert.equal(r.progress.shipped.eq(100), true);
    assert.ok(r.inconsistencies.some((i) => i.code === "EXCESS_COVERAGE"));
  });

  it("isOverdue quando promisedDeliveryAt passou e não concluído", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 1,
        statusNormalized: "PENDING",
        promisedDeliveryAt: "2026-01-01T00:00:00.000Z",
        referenceDate: "2026-07-17T00:00:00.000Z",
      })
    );
    assert.equal(r.isOverdue, true);

    const done = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
        promisedDeliveryAt: "2026-01-01T00:00:00.000Z",
        referenceDate: "2026-07-17T00:00:00.000Z",
      })
    );
    assert.equal(done.currentStage, "SHIPPED_COMPLETED");
    assert.equal(done.isOverdue, false);
  });

  it("não usa Number comum nas quantidades críticas (Prisma.Decimal)", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        orderedQuantity: D("10.5"),
        fulfilledQuantity: D("2.25"),
        status: 3,
        statusNormalized: "PARTIAL",
        productCommercialClass: "RESALE",
      })
    );
    assert.ok(r.orderedQuantity instanceof Prisma.Decimal);
    assert.ok(r.activeRemainingQuantity instanceof Prisma.Decimal);
    assert.ok(r.documentedQuantity instanceof Prisma.Decimal);
    assert.ok(r.progress.documented instanceof Prisma.Decimal);
    assert.equal(r.activeRemainingQuantity?.eq(D("8.25")), true);
  });

  it("corte sem status oficial → CUT_WITHOUT_OFFICIAL_STATUS", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        status: 2,
        statusNormalized: "RELEASED",
        nomusIsCut: true,
        productCommercialClass: "RESALE",
      })
    );
    assert.ok(
      r.inconsistencies.some((i) => i.code === "CUT_WITHOUT_OFFICIAL_STATUS")
    );
  });

  it("OP sem linkedQuantity → OP_LINK_WITHOUT_QUANTITY", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [{ linkedQuantity: null, isCurrent: true }],
      })
    );
    assert.ok(
      r.inconsistencies.some((i) => i.code === "OP_LINK_WITHOUT_QUANTITY")
    );
    assert.equal(r.productionOrderQuantity.eq(0), true);
  });

  it("integra pack OP-49 via resolveSalesOrderItemFlowFromEvidence", () => {
    const ORDER = "11111111-1111-1111-1111-111111111111";
    const ITEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-1",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: "2026-08-01T00:00:00.000Z",
          items: [
            {
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              skuSnapshot: "SKU",
              productNameSnapshot: "Prod",
              quantity: 10,
              nomusQuantityFulfilled: 0,
              nomusItemStatusRaw: "2",
              nomusItemStatusNormalized: "RELEASED",
              nomusItemExternalId: 501,
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      productionLinks: [
        {
          id: "l1",
          productionOrderId: "op1",
          productionOrderExternalId: 1,
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          externalSalesOrderId: 1,
          externalSalesOrderItemId: 501,
          linkedQuantity: 10,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: "op1", externalId: 1, quantity: 10, status: "Liberada" },
      ],
    });
    const pack = map.get(ORDER)!;
    const r = resolveSalesOrderItemFlowFromEvidence(pack, ITEM, {
      referenceDate: "2026-07-17T00:00:00.000Z",
    });
    assert.ok(r);
    assert.equal(r!.requiresProduction, true);
    assert.equal(r!.productionOrderQuantity.eq(10), true);
    // OP Liberada + qty planejada: motor atual libera o gate de OP e aguarda DS.
    assert.equal(r!.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.ok(
      r!.inconsistencies.some((i) => i.code === "PRODUCTION_QTY_NOT_NORMALIZED")
    );
  });

  it("dedupa alocações documentais pela allocationKey", () => {
    const r = resolveSalesOrderItemFlow(
      base({
        productCommercialClass: "RESALE",
        documentAllocations: [
          { allocationKey: "same", quantity: 4 },
          { allocationKey: "same", quantity: 4 },
          { allocationKey: "other", quantity: 2 },
        ],
      })
    );
    assert.equal(r.documentedQuantity.eq(6), true);
  });

  it("evidence: isCancelled=true exclui Documento mesmo sem statusRaw cancel*", () => {
    const ORDER = "22222222-2222-2222-2222-222222222222";
    const ITEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD-2",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          expectedDeliveryDate: null,
          items: [
            {
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              skuSnapshot: "SKU",
              productNameSnapshot: "Prod",
              quantity: 10,
              nomusQuantityFulfilled: 0,
              nomusItemStatusRaw: "2",
              nomusItemStatusNormalized: "RELEASED",
              nomusItemExternalId: 601,
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      productionLinks: [
        {
          id: "l1",
          productionOrderId: "op1",
          productionOrderExternalId: 1,
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          externalSalesOrderId: 1,
          externalSalesOrderItemId: 601,
          linkedQuantity: 10,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: "op1", externalId: 1, quantity: 10, status: "Liberada" },
      ],
      stockDocuments: [
        {
          id: "doc1",
          externalId: 9001,
          statusRaw: "EMITIDO",
          isCancelled: true,
        },
      ],
      allocations: [
        {
          auditKey: "alloc-doc-1",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          stockDocumentExternalId: 9001,
          quantityUsedForOrder: 10,
        },
      ],
    });
    const pack = map.get(ORDER)!;
    assert.equal(pack.stockDocuments[0]?.isCancelled, true);
    const r = resolveSalesOrderItemFlowFromEvidence(pack, ITEM);
    assert.ok(r);
    assert.equal(r!.documentedQuantity.eq(0), true);
    // DS cancelado não conta; com OP Liberada o motor segue para aguardar DS válido.
    assert.equal(r!.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("PD 02586: DS + NF cancelada + NF autorizada (só via idNfe) → SHIPPED_COMPLETED", () => {
    const ORDER = "25862586-2586-2586-2586-258625862586";
    const ITEM = "aaaaaaaa-2586-aaaa-aaaa-aaaaaaaaaaa1";
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        {
          id: ORDER,
          orderCode: "PD 02586",
          status: "SENT_TO_NOMUS",
          customerId: "c1",
          externalSalesOrderId: 2586,
          items: [
            {
              id: ITEM,
              salesOrderId: ORDER,
              productId: "p1",
              skuSnapshot: "010.04AA",
              productNameSnapshot: "Torneira",
              quantity: 1,
              nomusQuantityFulfilled: 1,
              nomusItemStatusRaw: "4",
              nomusItemStatusNormalized: "FULFILLED",
              nomusItemExternalId: 10,
            },
          ],
        },
      ],
      products: [
        {
          id: "p1",
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      nfeLinks: [
        {
          id: "link-cancel",
          salesOrderId: ORDER,
          nfeExternalId: 7135,
          nfeStatus: 7,
          nfeNumber: "7135",
        },
      ],
      stockDocuments: [
        {
          id: "doc-4220",
          externalId: 4220,
          idNfe: 7142,
          statusRaw: "EMITIDO",
          isCancelled: false,
          externalSalesOrderId: 2586,
          orderCodeNormalized: "PD02586",
          totalValue: 2850,
        },
        {
          id: "doc-4221",
          externalId: 4221,
          idNfe: 7135,
          statusRaw: "CANCELADO",
          isCancelled: true,
          externalSalesOrderId: 2586,
          orderCodeNormalized: "PD02586",
          totalValue: 2850,
        },
      ],
      allocations: [
        {
          auditKey: "alloc-ds",
          runId: "run-1",
          lineType: "STOCK_DOCUMENT",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          stockDocumentExternalId: 4220,
          quantityUsedForOrder: 1,
        },
        {
          // Qty 0 na NF não pode bloquear o fallback da autorizada 7142.
          auditKey: "alloc-nfe-zero",
          runId: "run-1",
          lineType: "NFE",
          salesOrderId: ORDER,
          salesOrderItemId: ITEM,
          nfeExternalId: 7142,
          quantityUsedForOrder: 0,
        },
      ],
      nomusNfes: [
        { id: "n7135", externalId: 7135, numero: "7135", serie: "2", status: 7 },
        { id: "n7142", externalId: 7142, numero: "7142", serie: "2", status: 4 },
      ],
    });
    const pack = map.get(ORDER)!;
    assert.ok(pack.validNfes.some((n) => n.externalId === 7142));
    assert.ok(pack.canceledNfes.some((n) => n.externalId === 7135));
    const r = resolveSalesOrderItemFlowFromEvidence(pack, ITEM);
    assert.ok(r);
    assert.equal(r!.currentStage, "SHIPPED_COMPLETED");
    assert.ok(r!.invoicedQuantity.gt(0));
    assert.doesNotMatch(r!.stageReason, /falta NF-e válida/i);
  });
});
