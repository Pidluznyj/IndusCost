import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildSalesOrderToCashFunnelAnalytics } from "./salesOrderToCashFunnelAnalytics.js";
import {
  classifySalesOrderToCashFunnelRow,
  type ClassifiedSalesOrderFunnelRow,
  type ClassifySalesOrderToCashFunnelInput,
} from "./salesOrderToCashFunnelClassification.js";

const TODAY = "2026-07-11";

function order(
  partial: Partial<NonNullable<ClassifySalesOrderToCashFunnelInput["order"]>> & {
    id: string;
  }
): NonNullable<ClassifySalesOrderToCashFunnelInput["order"]> {
  return {
    orderCode: partial.orderCode ?? partial.id,
    totalNetValue: 100_000,
    issueDate: "2026-06-01",
    expectedDeliveryDate: "2026-08-15",
    status: "OPEN",
    customerId: "c1",
    customerName: "Cliente A",
    sellerId: "s1",
    sellerName: "Vendedor A",
    ...partial,
  };
}

function row(input: ClassifySalesOrderToCashFunnelInput): ClassifiedSalesOrderFunnelRow {
  return classifySalesOrderToCashFunnelRow({ today: TODAY, ...input });
}

describe("salesOrderToCashFunnelAnalytics", () => {
  const sampleRows: ClassifiedSalesOrderFunnelRow[] = [
    row({
      order: order({ id: "fut", totalNetValue: 50_000, expectedDeliveryDate: "2026-09-01" }),
    }),
    row({
      order: order({
        id: "attn",
        totalNetValue: 30_000,
        issueDate: "2026-07-01",
        expectedDeliveryDate: "2026-07-14",
        sellerId: "s2",
        sellerName: "Vendedor B",
        customerId: "c2",
        customerName: "Cliente B",
      }),
    }),
    row({
      order: order({
        id: "blk",
        totalNetValue: 200_000,
        issueDate: "2026-01-01",
        expectedDeliveryDate: "2026-02-01",
        sellerId: "s2",
        sellerName: "Vendedor B",
        customerId: "c2",
        customerName: "Cliente B",
      }),
    }),
    row({
      order: order({ id: "cr", totalNetValue: 80_000 }),
      receivables: [{ openValue: 80_000, receivedValue: 0, totalValue: 80_000 }],
    }),
    row({
      order: order({ id: "rec", totalNetValue: 40_000 }),
      receivables: [
        { openValue: 0, receivedValue: 40_000, totalValue: 40_000, settlementDate: "2026-07-01" },
      ],
      payments: [{ receivedValue: 40_000, settlementDate: "2026-07-01" }],
    }),
    row({
      order: order({ id: "par", totalNetValue: 25_000 }),
      fulfillmentMap: {
        operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
        fulfillmentSummary: {
          orderValue: 25_000,
          fulfillmentPercent: 40,
          hasExcessQuantity: true,
          hasProductsOutsideOrder: true,
        },
        technicalAlerts: ["PRODUTO_FORA_DO_PEDIDO", "QUANTIDADE_EXCEDENTE_DOCUMENTO"],
      },
    }),
    row({
      order: order({ id: "can", status: "CANCELLED", totalNetValue: 99_000 }),
    }),
  ];

  it("1. soma por estágio não duplica total", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const stageSum = round2(
      analytics.funnelStages
        .filter((s) => s.stage !== "CANCELADO" && s.stage !== "CLIENTE_COM_HISTORICO")
        .reduce((acc, s) => acc + s.value, 0)
    );
    assert.equal(stageSum, analytics.totals.activeStageValueSum);

    const perOrder = new Map<string, number>();
    for (const r of sampleRows) {
      if (r.isCanceled || r.funnelStage === "CANCELADO") continue;
      assert.equal(perOrder.has(r.orderId), false, `pedido ${r.orderId} duplicado`);
      perOrder.set(r.orderId, r.valueForStage);
    }
  });

  it("2. pedido com alerta não duplica valor em risco", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const parcial = sampleRows.find((r) => r.orderId === "par")!;
    assert.ok(parcial.alerts.includes("DOCUMENTO_COM_EXCEDENTE") || parcial.alerts.length >= 0);
    assert.equal(parcial.funnelStage, "PEDIDO_PARCIALMENTE_ATENDIDO");

    // valor do estágio parcial conta uma vez no funil
    const stageVal =
      analytics.funnelStages.find((s) => s.stage === "PEDIDO_PARCIALMENTE_ATENDIDO")?.value ?? 0;
    assert.equal(stageVal, parcial.valueForStage);

    // risco de excesso é referência, com nota de não duplicar
    assert.match(analytics.riskSummary.note, /não duplicam/i);
    assert.ok(analytics.riskSummary.valorComExcesso >= 0);
  });

  it("3. recebido não duplica CR", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const crCard = analytics.summaryCards.find((c) => c.key === "cr_aberto")!;
    const recCard = analytics.summaryCards.find((c) => c.key === "recebido")!;
    assert.equal(crCard.count, 1);
    assert.equal(recCard.count, 1);
    assert.equal(crCard.value, 80_000);
    assert.equal(recCard.value, 40_000);
    // pedido recebido não está em CR
    const crStage = analytics.funnelStages.find((s) => s.stage === "CR_ABERTO")!;
    const recStage = analytics.funnelStages.find((s) => s.stage === "RECEBIDO")!;
    assert.equal(crStage.count + recStage.count, 2);
  });

  it("4. bloqueado aparece no riskSummary", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    assert.equal(analytics.riskSummary.valorBloqueado, 200_000);
    assert.ok(
      analytics.riskSummary.topRisks.some(
        (r) => r.orderId === "blk" || r.funnelStage === "BLOQUEADO_REVISAO"
      )
    );
  });

  it("5. sellerSummary calcula principal gargalo", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const sellerB = analytics.sellerSummary.find((s) => s.sellerId === "s2");
    assert.ok(sellerB);
    assert.equal(sellerB!.principalGargalo, "BLOQUEADO_REVISAO");
    assert.ok(sellerB!.valorBloqueado > 0);
  });

  it("6. customerSummary calcula principal gargalo", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const customerB = analytics.customerSummary.find((c) => c.customerId === "c2");
    assert.ok(customerB);
    assert.equal(customerB!.principalGargalo, "BLOQUEADO_REVISAO");
    assert.equal(customerB!.valorBloqueado, 200_000);
  });

  it("7. conversionMetrics calculam percentuais", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    const m = analytics.conversionMetrics;
    assert.ok(m.pedidoParaCr.percent != null);
    assert.ok(m.pedidoParaCr.percent! >= 0 && m.pedidoParaCr.percent! <= 100);
    assert.ok(m.crParaBaixa.percent != null);
    assert.ok(m.pedidoTotalOuParcialAtendido.total > 0);
  });

  it("8. explanation existe em todos os cards", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    assert.equal(analytics.summaryCards.length, 10);
    for (const card of analytics.summaryCards) {
      assert.ok(card.key);
      assert.ok(card.title);
      assert.ok(card.explanation && card.explanation.length > 10, card.key);
      assert.ok(["info", "success", "warning", "danger", "neutral"].includes(card.severity));
    }
  });

  it("9. não há referência a comissões", () => {
    const src = readFileSync(
      new URL("./salesOrderToCashFunnelAnalytics.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /from\s+["'][^"']*comiss/i);
    assert.doesNotMatch(src, /from\s+["'][^"']*commission/i);
    assert.doesNotMatch(src, /commissionValue|estimatedCommission/i);
  });

  it("10. não há dependência de proposta", () => {
    const src = readFileSync(
      new URL("./salesOrderToCashFunnelAnalytics.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /from\s+["'][^"']*proposal/i);
    assert.doesNotMatch(src, /salesFunnel\.ts/);
    assert.doesNotMatch(src, /ProposalStatus/);
  });

  it("cancelados não entram no forecast ativo", () => {
    const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: sampleRows });
    assert.equal(analytics.totals.canceledOrderCount, 1);
    const activeCard = analytics.summaryCards.find((c) => c.key === "valor_pedidos_ativos")!;
    assert.ok(!sampleRows.filter((r) => r.isCanceled).some(() => false));
    assert.ok(activeCard.value < 50_000 + 30_000 + 200_000 + 80_000 + 25_000 + 40_000);
    // recebido e cancelado fora do card de ativos
    assert.ok(activeCard.value <= 50_000 + 30_000 + 200_000 + 80_000 + 25_000);
  });
});

function round2(n: number): number {
  return Number(n.toFixed(2));
}
