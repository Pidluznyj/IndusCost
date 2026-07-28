/**
 * KAN-VAL-01 — Matriz obrigatória de regras operacionais do Kanban.
 * Motor canônico puro (sem Prisma/I/O). Códigos/clientes genéricos — sem exceção por pedido.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSalesOrderItemFlow,
  type ResolveSalesOrderItemFlowInput,
} from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { pickSalesOrderFlowStageFromItemStages } from "./salesOrderFlowCatalog.js";

function mfg(
  partial: Partial<ResolveSalesOrderItemFlowInput> & { salesOrderItemId: string }
): ResolveSalesOrderItemFlowInput {
  return {
    status: 2,
    statusNormalized: "RELEASED",
    costingMode: "OWN_PROCESS",
    hasProductRouting: true,
    hasProductBom: true,
    productionOrderLinks: [],
    documentAllocations: [],
    nfeAllocations: [],
    ...partial,
  };
}

function withDocNf(
  qty: number,
  options?: { shipDate?: boolean }
): Pick<
  ResolveSalesOrderItemFlowInput,
  "documentAllocations" | "nfeAllocations"
> {
  return {
    documentAllocations: [{ allocationKey: `doc-${qty}`, quantity: qty }],
    nfeAllocations: [
      {
        nfeExternalId: qty,
        quantity: qty,
        isValidForBilling: true,
        hasDocument: true,
        hasShipDate: options?.shipDate !== false,
      },
    ],
  };
}

describe("KAN-VAL-01 — obrigação ativa, corte, estoque, OP e gargalo", () => {
  it("1 — atendimento parcial sem corte: saldo 400, permanece operacional", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s1",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 600,
      })
    );
    assert.equal(r.activeObligationQuantity.eq(1000), true);
    assert.equal(r.remainingFulfillmentQuantity.eq(400), true);
    assert.equal(r.cutQuantity.eq(0), true);
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.isActiveForKanban, true);
  });

  it("2 — atendimento com corte do restante: obrigação 600, saldo 0, não aguarda OP", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s2",
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 1000,
        fulfilledQuantity: 600,
        ...withDocNf(600, { shipDate: false }),
      })
    );
    assert.equal(r.activeObligationQuantity.eq(600), true);
    assert.equal(r.cutQuantity.eq(400), true);
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("3 — atendimento integral sem OP: saldo 0, não aguarda OP", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s3",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: 1000,
        ...withDocNf(1000),
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(r.fulfilledWithoutProduction, true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("4 — atendimento parcial sem OP: residual 600 exige OP", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s4",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 400,
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(600), true);
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.match(r.stageReason, /não há Ordem de Produção válida/i);
  });

  it("5 — parcial com OP suficiente para residual: não ausência de OP", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s5",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 400,
        productionOrderLinks: [{ linkedQuantity: 600, isCurrent: true }],
        documentAllocations: [{ allocationKey: "d", quantity: 400 }],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(600), true);
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("6 — parcial com OP insuficiente: cobertura parcial, não ausência total", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s6",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 400,
        productionOrderLinks: [{ linkedQuantity: 300, isCurrent: true }],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(600), true);
    assert.equal(r.productionOrderQuantity.eq(300), true);
    assert.equal(r.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.match(r.stageReason, /parcial|não cobre/i);
    assert.match(r.stageReason, /não é ausência total/i);
    assert.doesNotMatch(r.stageReason, /não há Ordem de Produção válida/);
  });

  it("7 — corte parcial oficial ainda com saldo: obrigação 800, residual 300", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s7",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 500,
        officialCutQuantity: 200,
      })
    );
    assert.equal(r.cutQuantity.eq(200), true);
    assert.equal(r.activeObligationQuantity.eq(800), true);
    assert.equal(r.remainingFulfillmentQuantity.eq(300), true);
    assert.equal(r.isActiveForKanban, true);
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("8 — cancelamento parcial cobrindo o restante: saldo 0", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s8",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 1000,
        fulfilledQuantity: 700,
        officialCanceledQuantity: 300,
        ...withDocNf(700, { shipDate: false }),
      })
    );
    assert.equal(r.canceledQuantity.eq(300), true);
    assert.equal(r.activeObligationQuantity.eq(700), true);
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("9 — enviado sem OP: SHIPPED_COMPLETED, sem regressão", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s9",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 100,
        fulfilledQuantity: 100,
        ...withDocNf(100),
      })
    );
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("10 — faturamento parcial: parte não documentada permanece pendente", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s10",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: 1000,
        documentAllocations: [{ allocationKey: "d", quantity: 400 }],
        nfeAllocations: [
          {
            nfeExternalId: 10,
            quantity: 400,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(r.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("11 — vários itens: pedido no estágio mais anterior (gargalo)", () => {
    const a = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "a",
        status: 1,
        statusNormalized: "PENDING",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      })
    );
    const b = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "b",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [{ allocationKey: "db", quantity: 10 }],
      })
    );
    const c = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "c",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        ...withDocNf(10),
      })
    );
    assert.equal(a.currentStage, "WAITING_RELEASE");
    // Documento completo sem NF → aguarda NF-e (não regride para OP).
    assert.equal(b.currentStage, "WAITING_NFE");
    assert.equal(c.currentStage, "SHIPPED_COMPLETED");

    const order = resolveSalesOrderFlow([a, b, c], {
      salesOrderId: "order-11",
      itemFinancials: [
        { salesOrderItemId: "a", plannedNetValue: 100 },
        { salesOrderItemId: "b", plannedNetValue: 100 },
        { salesOrderItemId: "c", plannedNetValue: 100 },
      ],
    });
    assert.equal(order.currentStage, "WAITING_RELEASE");
    assert.equal(order.currentBottleneck?.salesOrderItemId, "a");
    assert.equal(order.currentBottleneck?.stage, "WAITING_RELEASE");
    assert.ok(order.nextAction);
    assert.ok(order.responsibleArea);
  });

  it("12 — item com corte + item parcial: pedido segue pelo parcial", () => {
    const cut = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "cut",
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 1000,
        fulfilledQuantity: 600,
        ...withDocNf(600),
      })
    );
    const partial = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "partial",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 500,
        fulfilledQuantity: 200,
      })
    );
    assert.equal(cut.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(partial.remainingFulfillmentQuantity.eq(300), true);

    const order = resolveSalesOrderFlow([cut, partial], {
      salesOrderId: "order-12",
      itemFinancials: [
        { salesOrderItemId: "cut", plannedNetValue: 1000 },
        { salesOrderItemId: "partial", plannedNetValue: 500 },
      ],
    });
    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(order.currentBottleneck?.salesOrderItemId, "partial");
    assert.ok(order.badges.includes("CUT"));
    assert.ok(order.badges.includes("PARTIAL"));
  });

  it("13 — todos os itens atendidos com corte: sem pendência de atendimento", () => {
    const items = ["x", "y"].map((id) =>
      resolveSalesOrderItemFlow(
        mfg({
          salesOrderItemId: id,
          status: 5,
          statusNormalized: "FULFILLED_WITH_CUT",
          orderedQuantity: 100,
          fulfilledQuantity: 70,
          ...withDocNf(70, { shipDate: false }),
        })
      )
    );
    assert.ok(items.every((i) => i.remainingFulfillmentQuantity.eq(0)));
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-13",
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    assert.equal(order.currentStage, "SHIPPED_COMPLETED");
    assert.ok(order.badges.includes("CUT"));
  });

  it("14 — Documento de Saída integral sem produção: não aguarda OP", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s14",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: 1000,
        documentAllocations: [{ allocationKey: "d", quantity: 1000 }],
        nfeAllocations: [],
      })
    );
    assert.equal(r.currentStage, "WAITING_NFE");
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("15 — NF e envio integral: concluído; terminal prevalece", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s15",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: 1000,
        ...withDocNf(1000),
      })
    );
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("16 — pedido totalmente cancelado: fora das colunas operacionais", () => {
    const item = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s16",
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 1000,
        fulfilledQuantity: 0,
      })
    );
    assert.equal(item.currentStage, "CANCELED");
    assert.equal(item.isActiveForKanban, false);

    const order = resolveSalesOrderFlow([item], {
      salesOrderId: "order-16",
      orderStatus: "CANCELLED",
      itemFinancials: [{ salesOrderItemId: "s16", plannedNetValue: 1000 }],
    });
    assert.equal(order.currentStage, "CANCELED");
    assert.equal(order.isInActiveOperationalColumn, false);
  });

  it("17 — quantidades excedentes: saldo zero, sem negativo, sem regressão", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s17",
        status: 4,
        statusNormalized: "FULFILLED",
        orderedQuantity: 1000,
        fulfilledQuantity: 1050,
        ...withDocNf(1050),
      })
    );
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
    assert.ok(r.remainingFulfillmentQuantity.gte(0));
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.ok(r.inconsistencies.some((i) => i.code === "EXCESS_COVERAGE"));
  });

  it("18 — valores nulos: comportamento determinístico sem inventar conclusão", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "s18",
        status: null,
        statusNormalized: "UNKNOWN",
        orderedQuantity: 100,
        fulfilledQuantity: null,
      })
    );
    assert.equal(r.currentStage, "WAITING_RELEASE");
    assert.notEqual(r.currentStage, "SHIPPED_COMPLETED");
    assert.ok(r.inconsistencies.some((i) => i.code === "ITEM_STATUS_UNKNOWN"));
  });

  it("19 — paridade estágio item → pedido → votação de gargalo", () => {
    const items = [
      resolveSalesOrderItemFlow(
        mfg({
          salesOrderItemId: "p1",
          status: 3,
          statusNormalized: "PARTIAL",
          orderedQuantity: 100,
          fulfilledQuantity: 40,
        })
      ),
      resolveSalesOrderItemFlow(
        mfg({
          salesOrderItemId: "p2",
          status: 4,
          statusNormalized: "FULFILLED",
          orderedQuantity: 100,
          fulfilledQuantity: 100,
          ...withDocNf(100),
        })
      ),
    ];
    const voted = pickSalesOrderFlowStageFromItemStages(
      items.map((i) => (i.isActiveForKanban ? i.currentStage : "CANCELED"))
    );
    const order = resolveSalesOrderFlow(items, {
      salesOrderId: "order-19",
      itemFinancials: items.map((i) => ({
        salesOrderItemId: i.salesOrderItemId,
        plannedNetValue: 100,
      })),
    });
    assert.equal(voted, order.currentStage);
    assert.equal(order.currentBottleneck?.stage, order.currentStage);
    assert.equal(order.activeResidualValue.gt(0), true);
  });

  it("20 — regra genérica: mesmos resultados com códigos/clientes diferentes", () => {
    const run = (id: string) =>
      resolveSalesOrderItemFlow(
        mfg({
          salesOrderItemId: id,
          status: 5,
          statusNormalized: "FULFILLED_WITH_CUT",
          orderedQuantity: 1000,
          fulfilledQuantity: 600,
          ...withDocNf(600),
        })
      );
    const a = run("cliente-alpha-item");
    const b = run("cliente-beta-item");
    assert.equal(a.currentStage, b.currentStage);
    assert.equal(a.cutQuantity.eq(b.cutQuantity), true);
    assert.equal(a.remainingFulfillmentQuantity.eq(0), true);
    assert.equal(b.remainingFulfillmentQuantity.eq(0), true);
  });

  it("proteção: corte/cancelamento não ultrapassam ordered; atendimento excessivo não gera residual negativo", () => {
    const r = resolveSalesOrderItemFlow(
      mfg({
        salesOrderItemId: "guard",
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 100,
        fulfilledQuantity: 50,
        officialCutQuantity: 80,
        officialCanceledQuantity: 40,
      })
    );
    // cancel 40 → rest 60; cut capped to 60 → obligation 0
    assert.equal(r.canceledQuantity.eq(40), true);
    assert.equal(r.cutQuantity.eq(60), true);
    assert.equal(r.activeObligationQuantity.eq(0), true);
    assert.equal(r.remainingFulfillmentQuantity.eq(0), true);
  });
});
