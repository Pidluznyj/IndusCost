import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaymentTermsAnalysis,
  buildPaymentTermsCell,
  buildPaymentTermsDetail,
  buildSupplierPaymentTermsDetail,
  computeSupplierOpportunity,
  evaluatePaymentTermsOrder,
  paymentTermsGapDays,
  periodDays,
  previousPeriod,
  type PaymentTermsOrderInput,
} from "./purchasePaymentTermsAnalysis.js";
import { parsePurchaseOrderPlannedInstallments } from "../nomus/nomusPurchaseOrder360.js";
import {
  formatPaymentTermsGap,
  formatPaymentTermsMoney,
  paymentTermsDelta,
  paymentTermsPeriodFromPreset,
} from "./purchasePaymentTermsUi.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => {
  const x = d(iso);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

let seq = 0;
function order(over: Partial<PaymentTermsOrderInput> & { days?: number[]; amounts?: number[] } = {}): PaymentTermsOrderInput {
  seq += 1;
  const issued = over.issuedDate ?? "2026-10-05";
  const days = over.days ?? [30];
  const amounts = over.amounts ?? days.map(() => 1000);
  return {
    id: `o${seq}`,
    externalId: over.externalId ?? seq,
    orderNumber: `PC${seq}`,
    supplierExternalId: over.supplierExternalId ?? 10,
    supplierName: over.supplierName ?? "Fornecedor A",
    buyerPersonId: "buyerPersonId" in over ? (over.buyerPersonId ?? null) : 1120,
    issuedDate: issued,
    stage: over.stage ?? "RECEIVED",
    canceled: over.canceled ?? false,
    totalAmount: over.totalAmount ?? amounts.reduce((a, b) => a + b, 0),
    conditionText: over.conditionText ?? ".",
    installments:
      over.installments ?? days.map((n, index) => ({ index, dueDate: issued ? addDays(issued, n) : null, amount: amounts[index] })),
  };
}

const OCT: { from: string; to: string } = { from: "2026-10-01", to: "2026-10-31" };

describe("PMP desde a emissão — pedido", () => {
  it("PC00632 (referência real): 32/62/83/92 → PMP 67,25 (exibido 67), sem arredondar para 30/60/90", () => {
    const rows = parsePurchaseOrderPlannedInstallments({
      parcelas: [
        { dataVencimento: "14/11/2026", valorParcela: "20.834,38" },
        { dataVencimento: "14/12/2026", valorParcela: "20.834,38" },
        { dataVencimento: "04/01/2027", valorParcela: "20.834,38" },
        { dataVencimento: "13/01/2027", valorParcela: "20.834,36" },
      ],
    });
    // Emissão como o parser oficial grava (meia-noite local de São Paulo = 03:00Z).
    const cell = buildPaymentTermsCell({ installments: rows, issuedAt: new Date("2026-10-13T03:00:00.000Z"), totalAmount: 83337.5 }, null);
    assert.equal(cell.label, "32/62/83/92");
    assert.equal(cell.pmpDays, 67.25);
    assert.equal(cell.status, "IDENTIFIED");
    assert.equal(cell.gapDays, null, "sem meta não há classificação");
    assert.equal(cell.belowTarget, null);
  });

  it("pedido cancelado é marcado e fica fora da carteira; sem emissão → não identificado", () => {
    const canceled = evaluatePaymentTermsOrder(order({ stage: "CANCELED" }), 60);
    assert.equal(canceled.canceled, true);
    const noIssue = evaluatePaymentTermsOrder({ ...order(), issuedDate: null }, 60);
    assert.equal(noIssue.result.status, "NOT_IDENTIFIED");
    assert.equal(noIssue.pmpDays, null);
  });

  it("gap: ausente, negativo, zero e positivo", () => {
    assert.equal(paymentTermsGapDays(28, null), null);
    assert.equal(paymentTermsGapDays(28, 60), -32);
    assert.equal(paymentTermsGapDays(59.6, 60), 0);
    assert.equal(paymentTermsGapDays(75, 60), 15);
    assert.equal(formatPaymentTermsGap(-32), "−32 dias");
    assert.equal(formatPaymentTermsGap(0), "0 dia");
    assert.equal(formatPaymentTermsGap(15), "+15 dias");
  });

  it("detalhe: dias por parcela e condição textual '.' tratada como não informada", () => {
    const o = order({ days: [30, 60, 90], amounts: [3000, 3000, 3000] });
    const det = buildPaymentTermsDetail({ installments: o.installments, issuedAt: d(o.issuedDate!), totalAmount: 9000, conditionText: "." }, 60);
    assert.deepEqual(det.daysByInstallmentIndex, { 0: 30, 1: 60, 2: 90 });
    assert.equal(det.cell.pmpDays, 60);
    assert.equal(det.cell.gapDays, 0);
    assert.equal(det.conditionText, null);
    assert.match(det.baseNote, /não é uma condição contratual confirmada/);
  });
});

describe("Carteira, cobertura e períodos", () => {
  it("PMP ponderado pelo valor; cancelados fora; não identificados só na cobertura; sem duplicar pedidos", () => {
    const a = order({ days: [28], amounts: [1000] });
    const b = order({ days: [90], amounts: [9000] });
    const dup = { ...b }; // mesma identidade oficial (externalId)
    const noData = order({ installments: [], totalAmount: 5000 });
    const canceled = order({ days: [5], amounts: [100000], stage: "CANCELED" });
    const outOfPeriod = order({ issuedDate: "2026-09-10", days: [10], amounts: [1000] });
    const r = buildPaymentTermsAnalysis({ orders: [a, b, dup, noData, canceled, outOfPeriod], period: OCT, targetDays: 60 });
    assert.equal(r.portfolio.pmpDays, 83.8, "(1000×28 + 9000×90)/10000");
    assert.equal(r.portfolio.orderCount, 3);
    assert.equal(r.portfolio.identifiedCount, 2);
    assert.equal(r.portfolio.coveragePercentByValue, 66.67, "10.000 de 15.000");
    assert.equal(r.excluded.canceledCount, 1);
    assert.equal(r.notIdentifiedByReason[0].reason, "NO_INSTALLMENTS");
    assert.equal(r.portfolio.gapDays, 24);
    assert.equal(r.portfolio.belowTargetAmount, 1000);
    assert.equal(r.portfolio.belowTargetPercent, 10);
    assert.equal(r.previous?.pmpDays, 10, "período anterior com a mesma duração (setembro)");
    assert.equal(r.orders.length, 4, "pedidos do período, inclusive cancelado marcado");
    assert.ok(r.orders.some((o) => o.canceled));
  });

  it("sem meta: indicadores funcionam e nada é classificado", () => {
    const r = buildPaymentTermsAnalysis({ orders: [order({ days: [28] })], period: OCT, targetDays: null });
    assert.equal(r.portfolio.pmpDays, 28);
    assert.equal(r.portfolio.gapDays, null);
    assert.equal(r.portfolio.belowTargetPercent, null);
    assert.equal(r.portfolio.potentialWorkingCapital, null);
    assert.equal(r.suppliers[0].reliability, "NOT_CALCULABLE");
  });

  it("evolução mensal e faixas", () => {
    const r = buildPaymentTermsAnalysis({
      orders: [order({ issuedDate: "2026-08-10", days: [30] }), order({ issuedDate: "2026-09-10", days: [60] }), order({ issuedDate: "2026-09-20", installments: [] })],
      period: { from: "2026-08-01", to: "2026-09-30" },
      targetDays: null,
    });
    assert.deepEqual(r.monthly.map((m) => [m.month, m.pmpDays]), [["2026-08", 30], ["2026-09", 60]]);
    const byBucket = Object.fromEntries(r.buckets.map((b) => [b.bucket, b.count]));
    assert.equal(byBucket.D30_59, 1);
    assert.equal(byBucket.D60_89, 1);
    assert.equal(byBucket.NOT_IDENTIFIED, 1);
  });

  it("período anterior e duração", () => {
    assert.equal(periodDays(OCT), 31);
    assert.deepEqual(previousPeriod(OCT), { from: "2026-08-31", to: "2026-09-30" });
    assert.equal(paymentTermsDelta(65.4, 60.6), 4);
  });

  it("presets: mês corrente (padrão), 30/90 dias e ano corrente", () => {
    const today = new Date(2026, 9, 15);
    assert.deepEqual(paymentTermsPeriodFromPreset("currentMonth", today), { from: "2026-10-01", to: "2026-10-15" });
    assert.deepEqual(paymentTermsPeriodFromPreset("last30", today), { from: "2026-09-16", to: "2026-10-15" });
    assert.deepEqual(paymentTermsPeriodFromPreset("last90", today), { from: "2026-07-18", to: "2026-10-15" });
    assert.deepEqual(paymentTermsPeriodFromPreset("currentYear", today), { from: "2026-01-01", to: "2026-10-15" });
  });
});

describe("Fornecedores: oportunidade de capital de giro", () => {
  it("exemplo da diretoria: R$ 200.000/mês, PMP 28, meta 60 → R$ 213.333", () => {
    const o = computeSupplierOpportunity({
      summary: {
        orderCount: 6, purchaseAmount: 600000, identifiedCount: 6, identifiedPurchaseAmount: 600000, pmpDays: 28, gapDays: -32,
        coveragePercentByValue: 100, coveragePercentByCount: 100, belowTargetAmount: 600000, belowTargetCount: 6, belowTargetPercent: 100,
      },
      activeMonths: 3,
      periodDays: 91.3125, // 3 meses civis de exposição
      targetDays: 60,
    });
    assert.equal(o.monthlyVolume, 200000);
    assert.equal(o.extraDays, 32);
    assert.equal(o.potentialWorkingCapital, 213333.33);
    assert.equal(o.reliability, "OK");
    assert.equal(formatPaymentTermsMoney(o.potentialWorkingCapital), "R$ 213.333".replace(" ", " "));
  });

  it("período curto ou pouca recorrência → baixa confiabilidade; PMP ≥ meta → 0 dias adicionais", () => {
    const base = {
      orderCount: 1, purchaseAmount: 10000, identifiedCount: 1, identifiedPurchaseAmount: 10000, pmpDays: 28, gapDays: -32,
      coveragePercentByValue: 100, coveragePercentByCount: 100, belowTargetAmount: 10000, belowTargetCount: 1, belowTargetPercent: 100,
    };
    assert.equal(computeSupplierOpportunity({ summary: base, activeMonths: 1, periodDays: 31, targetDays: 60 }).reliability, "LOW");
    assert.equal(computeSupplierOpportunity({ summary: base, activeMonths: 1, periodDays: 365, targetDays: 60 }).reliability, "LOW");
    // Período parcial (< 1 mês) não extrapola: volume mensal = valor observado.
    assert.equal(computeSupplierOpportunity({ summary: base, activeMonths: 1, periodDays: 10, targetDays: 60 }).monthlyVolume, 10000);
    assert.equal(computeSupplierOpportunity({ summary: { ...base, pmpDays: 75 }, activeMonths: 4, periodDays: 365, targetDays: 60 }).potentialWorkingCapital, 0);
  });

  it("ranking pela oportunidade: fornecedor grande com 35 dias à frente do pequeno com 20 dias", () => {
    const big = Array.from({ length: 4 }, (_, i) =>
      order({ supplierExternalId: 1, supplierName: "Grande", issuedDate: `2026-0${7 + i}-10`, days: [35], amounts: [200000] }),
    );
    const small = Array.from({ length: 4 }, (_, i) =>
      order({ supplierExternalId: 2, supplierName: "Pequeno", issuedDate: `2026-0${7 + i}-12`, days: [20], amounts: [5000] }),
    );
    const r = buildPaymentTermsAnalysis({ orders: [...small, ...big], period: { from: "2026-07-01", to: "2026-10-31" }, targetDays: 60 });
    assert.deepEqual(r.suppliers.map((s) => s.supplierName), ["Grande", "Pequeno"]);
    assert.ok((r.suppliers[0].potentialWorkingCapital ?? 0) > (r.suppliers[1].potentialWorkingCapital ?? 0));
  });

  it("drill-down rastreia os pedidos, parcelas e evolução do fornecedor", () => {
    const orders = [
      order({ supplierExternalId: 7, issuedDate: "2026-10-02", days: [30, 60] }),
      order({ supplierExternalId: 7, issuedDate: "2026-10-20", installments: [] }),
      order({ supplierExternalId: 8, issuedDate: "2026-10-03", days: [90] }),
    ];
    const det = buildSupplierPaymentTermsDetail({ orders, period: OCT, targetDays: 60, supplierExternalId: 7 });
    assert.equal(det.supplier?.supplierExternalId, 7);
    assert.equal(det.orders.length, 2);
    assert.equal(det.supplier?.pmpDays, 45);
    assert.equal(det.monthly.length, 1);
    assert.equal(det.monthly[0].pmpDays, 45, "só os pedidos do fornecedor");
  });
});

describe("Compradores", () => {
  it("PMP por comprador com identificação oficial e evolução mensal", () => {
    const r = buildPaymentTermsAnalysis({
      orders: [
        order({ buyerPersonId: 1120, issuedDate: "2026-10-02", days: [30], amounts: [1000] }),
        order({ buyerPersonId: 1120, issuedDate: "2026-10-09", days: [60], amounts: [3000] }),
        order({ buyerPersonId: null, issuedDate: "2026-10-10", installments: [] }),
      ],
      period: OCT,
      targetDays: null,
    });
    const b = r.buyers.find((x) => x.buyerPersonId === 1120)!;
    assert.equal(b.label, "Comprador #1120");
    assert.equal(b.pmpDays, 52.5);
    assert.equal(b.monthly[0].month, "2026-10");
    const none = r.buyers.find((x) => x.buyerPersonId == null)!;
    assert.equal(none.label, "Sem comprador informado");
    assert.equal(none.pmpDays, null);
    assert.equal(none.coveragePercentByValue, 0);
  });
});
