/**
 * Correção Kanban — WAITING_NFE + evidência conservadora de OP Encerrada.
 * Cobre a matriz obrigatória do prompt de implementação (sem I/O).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  pickSalesOrderFlowStageFromItemStages,
  SALES_ORDER_ITEM_FLOW_STAGE_REASON,
} from "./salesOrderFlowCatalog.js";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import {
  buildSalesOrderItemFlowFingerprint,
} from "./salesOrderFlowFingerprint.js";

const D = (v: string | number) => new Prisma.Decimal(v);

function mfg(
  partial: Partial<ResolveSalesOrderItemFlowInput> & { salesOrderItemId?: string }
): ResolveSalesOrderItemFlowInput {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-1",
    orderedQuantity: partial.orderedQuantity ?? 10,
    fulfilledQuantity: partial.fulfilledQuantity ?? 0,
    status: partial.status ?? 2,
    statusNormalized: partial.statusNormalized ?? "RELEASED",
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    ...partial,
  };
}

function resale(
  partial: Partial<ResolveSalesOrderItemFlowInput>
): ResolveSalesOrderItemFlowInput {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-resale",
    orderedQuantity: partial.orderedQuantity ?? 10,
    fulfilledQuantity: partial.fulfilledQuantity ?? 0,
    status: partial.status ?? 2,
    statusNormalized: partial.statusNormalized ?? "RELEASED",
    productCommercialClass: "RESALE",
    ...partial,
  };
}

describe("salesOrderItemFlowEngine — correção WAITING_NFE / produção", () => {
  it("1. Cancelado permanece CANCELED", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({ status: 0, statusNormalized: "CANCELED", nomusIsCanceled: true })
    );
    assert.equal(r.currentStage, "CANCELED");
    assert.equal(r.isActiveForKanban, false);
  });

  it("2. NF válida cobrindo gera SHIPPED_COMPLETED mesmo com UNKNOWN", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        status: 99,
        statusNormalized: "UNKNOWN",
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
      })
    );
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.match(r.stageReason, /NF-e válida|INVOICED_QUANTITY_COMPLETED/);
  });

  it("3–5. DS cobre + NF insuficiente → WAITING_NFE (RELEASED / UNKNOWN / PENDING)", () => {
    for (const status of [
      { status: 2, statusNormalized: "RELEASED" as const },
      { status: 99, statusNormalized: "UNKNOWN" as const },
      { status: 1, statusNormalized: "PENDING" as const },
    ]) {
      const r = resolveSalesOrderItemFlow(
        mfg({
          ...status,
          documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
          nfeAllocations: [
            {
              nfeExternalId: 1,
              quantity: 3,
              isValidForBilling: true,
              hasDocument: true,
            },
          ],
        })
      );
      assert.equal(r.currentStage, "WAITING_NFE", status.statusNormalized);
      assert.equal(
        r.stageReason,
        SALES_ORDER_ITEM_FLOW_STAGE_REASON.DOCUMENTED_AWAITING_NFE
      );
    }
  });

  it("6–7. DS parcial → WAITING_OUTPUT_DOCUMENT (também com UNKNOWN; sem voltar a RELEASE)", () => {
    for (const statusNormalized of ["RELEASED", "UNKNOWN"] as const) {
      const r = resolveSalesOrderItemFlow(
        resale({
          status: statusNormalized === "UNKNOWN" ? 99 : 2,
          statusNormalized,
          documentAllocations: [{ allocationKey: "d1", quantity: 4 }],
        })
      );
      assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT", statusNormalized);
      assert.notEqual(r.currentStage, "WAITING_RELEASE");
    }

    const mfgPartialUnknown = resolveSalesOrderItemFlow(
      mfg({
        status: 99,
        statusNormalized: "UNKNOWN",
        documentAllocations: [{ allocationKey: "d1", quantity: 4 }],
        productionOrderLinks: [],
      })
    );
    // Fabricado sem OP: residual prevalece, mas não regressa a WAITING_RELEASE.
    assert.equal(mfgPartialUnknown.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.notEqual(mfgPartialUnknown.currentStage, "WAITING_RELEASE");
  });

  it("8. Sem DS e UNKNOWN → WAITING_RELEASE", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({ status: 99, statusNormalized: "UNKNOWN", productionOrderLinks: [] })
    );
    assert.equal(r.currentStage, "WAITING_RELEASE");
    assert.match(r.stageReason, /UNKNOWN_STATUS_WITHOUT_DOWNSTREAM_EVIDENCE/);
  });

  it("9. Item sem necessidade de produção segue DS/NF", () => {
    const r = resolveSalesOrderItemFlow(
      resale({
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
          },
        ],
      })
    );
    assert.equal(r.requiresProduction, false);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("10–11. Sem OP / OP insuficiente → WAITING_PRODUCTION_ORDER", () => {
    assert.equal(
      resolveSalesOrderItemFlow(mfg({ productionOrderLinks: [] })).currentStage,
      "WAITING_PRODUCTION_ORDER"
    );
    assert.equal(
      resolveSalesOrderItemFlow(
        mfg({
          productionOrderLinks: [
            { linkedQuantity: 3, isCurrent: true, status: "Liberada" },
          ],
        })
      ).currentStage,
      "WAITING_PRODUCTION_ORDER"
    );
  });

  it("12–14. Liberada / Requisitada* suficiente permanece WAITING_PRODUCTION_ORDER", () => {
    for (const status of [
      "Liberada",
      "Requisitada parcialmente",
      "Requisitada totalmente",
    ]) {
      const r = resolveSalesOrderItemFlow(
        mfg({
          productionOrderLinks: [
            { linkedQuantity: 10, isCurrent: true, status },
          ],
        })
      );
      assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER", status);
      assert.notEqual(r.currentStage, "IN_PRODUCTION");
      assert.notEqual(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    }
  });

  it("15. OP Encerrada insuficiente permanece WAITING_PRODUCTION_ORDER", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 4, isCurrent: true, status: "Encerrada" },
        ],
      })
    );
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("16. OP Encerrada cobrindo sem DS → WAITING_OUTPUT_DOCUMENT", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Encerrada" },
        ],
      })
    );
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.match(r.stageReason, /PRODUCTION_ORDER_CLOSED_AWAITING_OUTPUT_DOCUMENT/);
  });

  it("17. OP Encerrada + DS suficiente + NF insuficiente → WAITING_NFE", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Encerrada" },
        ],
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 2,
            isValidForBilling: true,
            hasDocument: true,
          },
        ],
      })
    );
    assert.equal(r.currentStage, "WAITING_NFE");
  });

  it("18. OP Encerrada + NF suficiente → SHIPPED_COMPLETED", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Encerrada" },
        ],
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
          },
        ],
      })
    );
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("19. OP Cancelada não conta quantidade", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          {
            linkedQuantity: 10,
            isCurrent: true,
            status: "Cancelada",
            productionOrderId: "op-c",
          },
        ],
      })
    );
    assert.equal(r.productionOrderQuantity.eq(0), true);
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("20. Mistura Encerrada + Liberada soma grupos corretamente", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        orderedQuantity: 10,
        productionOrderLinks: [
          {
            linkedQuantity: 6,
            isCurrent: true,
            status: "Encerrada",
            productionOrderId: "op-e",
          },
          {
            linkedQuantity: 4,
            isCurrent: true,
            status: "Liberada",
            productionOrderId: "op-l",
          },
        ],
      })
    );
    assert.equal(r.productionOrderQuantity.eq(10), true);
    // Encerrada 6 < residual 10 → ainda aguarda execução do restante.
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("21–23. producedQuantity real parcial/total; null nunca IN_PRODUCTION", () => {
    const partial = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Liberada" },
        ],
        producedQuantity: 4,
      })
    );
    assert.equal(partial.currentStage, "IN_PRODUCTION");
    assert.match(partial.stageReason, /PRODUCED_QUANTITY_PARTIAL/);

    const full = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Liberada" },
        ],
        producedQuantity: 10,
      })
    );
    assert.equal(full.currentStage, "WAITING_OUTPUT_DOCUMENT");

    const nullProduced = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Liberada" },
        ],
        producedQuantity: null,
      })
    );
    assert.notEqual(nullProduced.currentStage, "IN_PRODUCTION");
  });

  it("24–26. Planejada / data / status desconhecido não concluem produção", () => {
    const planned = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Liberada" },
        ],
        promisedDeliveryAt: "2020-01-01T00:00:00.000Z",
        referenceDate: "2026-07-01T00:00:00.000Z",
      })
    );
    assert.equal(planned.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(planned.isOverdue, true);

    const unknownStatus = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Em andamento" },
        ],
      })
    );
    assert.equal(unknownStatus.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("27–28. Vínculo não atual / duplicado não conta duas vezes", () => {
    const stale = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          {
            linkedQuantity: 10,
            isCurrent: false,
            status: "Encerrada",
            productionOrderId: "op1",
          },
        ],
      })
    );
    assert.equal(stale.productionOrderQuantity.eq(0), true);

    const dup = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          {
            linkedQuantity: 10,
            isCurrent: true,
            status: "Encerrada",
            productionOrderId: "op1",
          },
          {
            linkedQuantity: 10,
            isCurrent: true,
            status: "Encerrada",
            productionOrderId: "op1",
          },
        ],
      })
    );
    assert.equal(dup.productionOrderQuantity.eq(10), true);
  });

  it("29–30. Gargalo do pedido: WAITING_NFE não promove se outro item está em OP", () => {
    const waitingOp = resolveSalesOrderItemFlow(
      mfg({ salesOrderItemId: "a", productionOrderLinks: [] })
    );
    const waitingNfe = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "b",
        productCommercialClass: "RESALE",
        costingMode: null,
        hasProductRouting: null,
        hasProductBom: null,
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      })
    );
    assert.equal(waitingOp.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(waitingNfe.currentStage, "WAITING_NFE");
    assert.equal(
      pickSalesOrderFlowStageFromItemStages([
        waitingOp.currentStage,
        waitingNfe.currentStage,
      ]),
      "WAITING_PRODUCTION_ORDER"
    );

    const order = resolveSalesOrderFlow([waitingOp, waitingNfe], {
      salesOrderId: "ord-1",
    });
    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("31. NF-e cancelada não conta em invoicedQuantity", () => {
    const r = resolveSalesOrderItemFlow(
      resale({
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
    assert.equal(r.currentStage, "WAITING_NFE");
  });

  it("32–33. Motivos determinísticos e fingerprint estável", () => {
    const a = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Encerrada" },
        ],
      })
    );
    const b = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: 10, isCurrent: true, status: "Encerrada" },
        ],
      })
    );
    assert.equal(a.stageReason, b.stageReason);
    assert.equal(
      buildSalesOrderItemFlowFingerprint(a),
      buildSalesOrderItemFlowFingerprint(b)
    );
  });

  it("24b. Quantidade planejada suficiente sozinha não gera produção concluída", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        productionOrderLinks: [
          { linkedQuantity: D(10), isCurrent: true, status: "Liberada" },
        ],
      })
    );
    assert.notEqual(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.producedQuantity, null);
  });
});
