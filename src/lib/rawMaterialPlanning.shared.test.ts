import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateBuyByDate,
  calculatePlanningConfidence,
  calculatePurchaseRecommendation,
  classifyRawMaterialPlanningStatus,
  projectRawMaterialBalance,
  resolveRawMaterialNeedByDate,
  resolveRawMaterialPlanningHorizonEndDate,
  resolveStockCountAgeDays,
  type RawMaterialTimelineEvent,
} from "./rawMaterialPlanning.shared.js";

const AS_OF = "2026-08-05";
const HORIZON_END = "2026-10-04"; // 60 dias

function demand(date: string, quantity: number, orderCode = "PD 00001"): RawMaterialTimelineEvent {
  return { kind: "demand", date, quantity, salesOrderId: orderCode, orderCode };
}

function inbound(date: string, quantity: number, code = "PC 00001"): RawMaterialTimelineEvent {
  return { kind: "inbound", date, quantity, purchaseOrderId: code, purchaseOrderCode: code, status: "APROVADO" };
}

describe("projectRawMaterialBalance — saldo contado vs. projetado", () => {
  it("1. estoque cobre toda a demanda e a proteção → sem data de risco", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 10000,
      minimumQuantity: 1000,
      contingencyQuantity: 500,
      events: [demand("2026-08-10", 2000), demand("2026-08-20", 1500)],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    assert.equal(p.firstRiskDate, null);
    assert.equal(p.protectionTotal, 1500);
    assert.ok(p.lowestProjectedBalance >= 1500);
  });

  it("2. estoque fica abaixo da proteção → tem data de risco", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 2500,
      minimumQuantity: 500,
      contingencyQuantity: 200,
      events: [demand("2026-08-10", 2200)],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    assert.equal(p.firstRiskDate, "2026-08-10");
    assert.equal(p.timeline.find((t) => t.date === "2026-08-10")?.freeBalance, -400);
  });

  it("3. entrada confirmada chega ANTES do que seria o risco → nunca fica negativo", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 1000,
      minimumQuantity: 500,
      contingencyQuantity: 0,
      events: [inbound("2026-08-08", 3000), demand("2026-08-10", 2000)],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    assert.equal(p.firstRiskDate, null);
  });

  it("4. entrada confirmada chega DEPOIS do risco → ainda fica negativo antes da entrada", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 1000,
      minimumQuantity: 500,
      contingencyQuantity: 0,
      events: [demand("2026-08-10", 2000), inbound("2026-08-20", 3000)],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    assert.equal(p.firstRiskDate, "2026-08-10");
  });

  it("8. estoque mínimo e contingência somam a proteção total corretamente", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 5000,
      minimumQuantity: 1200,
      contingencyQuantity: 300,
      events: [],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    assert.equal(p.protectionTotal, 1500);
    // saldo contado nunca é alterado pela projeção
    assert.equal(p.timeline[0]!.openingBalance, 5000);
    assert.equal(p.timeline[0]!.closingBalance, 5000);
  });

  it("15. dois pedidos na mesma data são somados de forma determinística", () => {
    const p = projectRawMaterialBalance({
      countedBalance: 1000,
      minimumQuantity: 0,
      contingencyQuantity: 0,
      events: [demand("2026-08-10", 300, "PD 1"), demand("2026-08-10", 200, "PD 2")],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    });
    const point = p.timeline.find((t) => t.date === "2026-08-10")!;
    assert.equal(point.outbound, 500);
    assert.equal(point.demandEvents.length, 2);
  });

  it("16. pedidos em datas diferentes acumulam a linha do tempo corretamente (exemplo do pedido)", () => {
    // Eventos reais do exemplo do pedido (19/08 a 21/08).
    const real = projectRawMaterialBalance({
      countedBalance: 436075.51,
      minimumQuantity: 0,
      contingencyQuantity: 0,
      events: [
        demand("2026-08-19", 27436.74),
        inbound("2026-08-19", 4973.76),
        demand("2026-08-20", 351151.17),
        inbound("2026-08-20", 151415.9),
        demand("2026-08-21", 15617.88),
        inbound("2026-08-21", 29018.54),
      ],
      asOfDate: "2026-08-19",
      horizonEndDate: "2026-08-21",
    });
    const byDate = new Map(real.timeline.map((t) => [t.date, t]));
    assert.equal(Math.round(byDate.get("2026-08-19")!.closingBalance * 100) / 100, 413612.53);
    assert.equal(Math.round(byDate.get("2026-08-20")!.closingBalance * 100) / 100, 213877.26);
    assert.equal(Math.round(byDate.get("2026-08-21")!.closingBalance * 100) / 100, 227277.92);
  });

  it("17. mesmos dados e mesmo asOfDate produzem a mesma resposta (determinismo)", () => {
    const input = {
      countedBalance: 1000,
      minimumQuantity: 100,
      contingencyQuantity: 50,
      events: [demand("2026-08-10", 300), inbound("2026-08-12", 200)],
      asOfDate: AS_OF,
      horizonEndDate: HORIZON_END,
    };
    assert.deepEqual(projectRawMaterialBalance(input), projectRawMaterialBalance({ ...input }));
  });
});

describe("calculatePurchaseRecommendation — necessidade técnica vs. quantidade sugerida", () => {
  it("9. lote mínimo e múltiplo ajustam a sugestão e o ajuste é explicado", () => {
    const r = calculatePurchaseRecommendation({ technicalNeed: 1280, minPurchaseLot: null, purchaseMultiple: 500 });
    assert.equal(r.technicalNeed, 1280);
    assert.equal(r.suggestedQuantity, 1500);
    assert.equal(r.lotAdjustment, 220);
    assert.match(r.adjustmentNote ?? "", /múltiplo de compra/);
  });

  it("sem lote/múltiplo cadastrados, sugestão = necessidade técnica, sem ajuste", () => {
    const r = calculatePurchaseRecommendation({ technicalNeed: 850, minPurchaseLot: null, purchaseMultiple: null });
    assert.equal(r.suggestedQuantity, 850);
    assert.equal(r.adjustmentNote, null);
  });

  it("necessidade técnica zero (coberto) → sugestão zero", () => {
    const r = calculatePurchaseRecommendation({ technicalNeed: -50, minPurchaseLot: 100, purchaseMultiple: 10 });
    assert.equal(r.suggestedQuantity, 0);
  });
});

describe("calculateBuyByDate — data limite de compra", () => {
  it("data de risco + lead time + aprovação + margem (exemplo do pedido)", () => {
    const r = calculateBuyByDate({
      firstRiskDate: "2026-08-25",
      leadTimeDays: 10,
      approvalDays: 2,
      logisticsMarginDays: 2,
    });
    assert.equal(r.buyByDate, "2026-08-11");
    assert.equal(r.blockedReason, null);
  });

  it("6. sem lead time confiável → não inventa data, marca motivo bloqueador", () => {
    const r = calculateBuyByDate({
      firstRiskDate: "2026-08-25",
      leadTimeDays: null,
      approvalDays: 2,
      logisticsMarginDays: 2,
    });
    assert.equal(r.buyByDate, null);
    assert.equal(r.blockedReason, "NO_LEAD_TIME");
  });

  it("sem data de risco → nada a comprar", () => {
    const r = calculateBuyByDate({ firstRiskDate: null, leadTimeDays: 10, approvalDays: 2, logisticsMarginDays: 2 });
    assert.equal(r.buyByDate, null);
    assert.equal(r.blockedReason, "NO_RISK");
  });
});

describe("classifyRawMaterialPlanningStatus", () => {
  const base = {
    asOfDate: AS_OF,
    firstRiskDate: null as string | null,
    buyByDate: null as string | null,
    buyByBlockedReason: null as "NO_RISK" | "NO_LEAD_TIME" | null,
    hasConfirmedInbound: false,
    inboundArrivesBeforeRisk: null as boolean | null,
    technicalNeed: 0,
    unitConversionError: false,
    stockCountAgeDays: 1,
    stockCountStaleDaysThreshold: 7,
  };

  it("1. coberto por estoque, sem entrada nenhuma → COVERED_BY_STOCK, sugestão zero é responsabilidade do chamador", () => {
    assert.equal(classifyRawMaterialPlanningStatus(base), "COVERED_BY_STOCK");
  });

  it("3. entrada confirmada chega antes do risco → COVERED_BY_CONFIRMED_INBOUND", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-10",
        buyByDate: "2026-08-01",
        hasConfirmedInbound: true,
        inboundArrivesBeforeRisk: true,
      }),
      "COVERED_BY_CONFIRMED_INBOUND"
    );
  });

  it("4. entrada confirmada chega depois do risco e cobre tudo → INBOUND_LATE", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-10",
        buyByDate: "2026-08-01",
        hasConfirmedInbound: true,
        inboundArrivesBeforeRisk: false,
        technicalNeed: 0,
      }),
      "INBOUND_LATE"
    );
  });

  it("5. estoque cobre só parte da demanda (entrada tardia mas ainda falta comprar) → PARTIALLY_COVERED", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-10",
        buyByDate: "2026-08-01",
        hasConfirmedInbound: true,
        inboundArrivesBeforeRisk: false,
        technicalNeed: 400,
      }),
      "PARTIALLY_COVERED"
    );
  });

  it("6. sem lead time confiável → DATA_INCOMPLETE, nunca finge uma data", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-25",
        buyByBlockedReason: "NO_LEAD_TIME",
      }),
      "DATA_INCOMPLETE"
    );
  });

  it("14. erro de unidade sempre vence qualquer outro sinal", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-01",
        buyByBlockedReason: "NO_LEAD_TIME",
        unitConversionError: true,
      }),
      "UNIT_CONVERSION_ERROR"
    );
  });

  it("7. contagem muito desatualizada vence status de compra (não afirma nada com dado velho)", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({
        ...base,
        firstRiskDate: "2026-08-06",
        buyByDate: "2026-08-05",
        stockCountAgeDays: 30,
        stockCountStaleDaysThreshold: 7,
      }),
      "STOCK_COUNT_STALE"
    );
  });

  it("data limite hoje/passada → BUY_NOW", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({ ...base, firstRiskDate: "2026-08-25", buyByDate: AS_OF }),
      "BUY_NOW"
    );
  });

  it("data limite dentro de 7 dias → BUY_WITHIN_7_DAYS", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({ ...base, firstRiskDate: "2026-08-25", buyByDate: "2026-08-10" }),
      "BUY_WITHIN_7_DAYS"
    );
  });

  it("data limite além de 7 dias → PLAN_PURCHASE", () => {
    assert.equal(
      classifyRawMaterialPlanningStatus({ ...base, firstRiskDate: "2026-09-25", buyByDate: "2026-08-25" }),
      "PLAN_PURCHASE"
    );
  });
});

describe("calculatePlanningConfidence — indicador operacional, não estatístico", () => {
  it("tudo em dia → HIGH", () => {
    const r = calculatePlanningConfidence({
      stockCountAgeDays: 1,
      stockCountRecentDaysThreshold: 3,
      stockCountStaleDaysThreshold: 7,
      hasLeadTime: true,
      hasUnresolvedBomOrAnalysisIssue: false,
      unitConversionError: false,
      hasOrdersWithoutNeedDate: false,
      inboundUnconfirmed: false,
    });
    assert.equal(r.level, "HIGH");
    assert.deepEqual(r.reasons, []);
  });

  it("7. contagem desatualizada reduz a confiança e explica o motivo", () => {
    const r = calculatePlanningConfidence({
      stockCountAgeDays: 12,
      stockCountRecentDaysThreshold: 3,
      stockCountStaleDaysThreshold: 7,
      hasLeadTime: true,
      hasUnresolvedBomOrAnalysisIssue: false,
      unitConversionError: false,
      hasOrdersWithoutNeedDate: false,
      inboundUnconfirmed: false,
    });
    assert.notEqual(r.level, "HIGH");
    assert.ok(r.reasons.some((x) => x.includes("desatualizada")));
  });

  it("vários problemas somados → LOW", () => {
    const r = calculatePlanningConfidence({
      stockCountAgeDays: null,
      stockCountRecentDaysThreshold: 3,
      stockCountStaleDaysThreshold: 7,
      hasLeadTime: false,
      hasUnresolvedBomOrAnalysisIssue: true,
      unitConversionError: true,
      hasOrdersWithoutNeedDate: true,
      inboundUnconfirmed: true,
    });
    assert.equal(r.level, "LOW");
  });
});

describe("resolveRawMaterialNeedByDate — nunca cai pro relógio como fallback silencioso", () => {
  it("usa data de entrega do pedido quando disponível", () => {
    assert.deepEqual(resolveRawMaterialNeedByDate({ expectedDeliveryDate: "2026-08-20" }), {
      date: "2026-08-20",
      source: "expectedDeliveryDate",
    });
  });

  it("sem data de entrega → sem data confiável (nunca usa hoje)", () => {
    assert.deepEqual(resolveRawMaterialNeedByDate({ expectedDeliveryDate: null }), {
      date: null,
      source: "none",
    });
  });
});

describe("resolveStockCountAgeDays", () => {
  it("calcula idade em dias a partir da última contagem", () => {
    assert.equal(resolveStockCountAgeDays("2026-08-01T10:00:00.000Z", "2026-08-05"), 4);
  });

  it("sem contagem registrada → null (nunca finge idade zero)", () => {
    assert.equal(resolveStockCountAgeDays(null, "2026-08-05"), null);
  });
});

describe("resolveRawMaterialPlanningHorizonEndDate", () => {
  it("30/60/90 dias a partir do asOfDate", () => {
    assert.equal(resolveRawMaterialPlanningHorizonEndDate("2026-08-05", "30"), "2026-09-04");
    assert.equal(resolveRawMaterialPlanningHorizonEndDate("2026-08-05", "60"), "2026-10-04");
    assert.equal(resolveRawMaterialPlanningHorizonEndDate("2026-08-05", "90"), "2026-11-03");
  });

  it("período personalizado usa a data informada", () => {
    assert.equal(
      resolveRawMaterialPlanningHorizonEndDate("2026-08-05", "custom", "2026-12-25"),
      "2026-12-25"
    );
  });
});
