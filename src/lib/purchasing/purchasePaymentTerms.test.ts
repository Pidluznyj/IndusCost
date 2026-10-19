import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregatePaymentTerms,
  calendarDaysBetween,
  classifyPaymentTermsBucket,
  computePurchasePaymentTerms,
  formatPmpDays,
  paymentTermsMeetsTarget,
  type PaymentTermsInstallmentInput,
} from "./purchasePaymentTerms.js";
import { parsePurchaseOrderPlannedInstallments } from "../nomus/nomusPurchaseOrder360.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const inst = (rows: Array<[string | null, number | null]>, extra: Partial<PaymentTermsInstallmentInput> = {}) =>
  rows.map(([due, amount], index) => ({ index, dueDate: due ? d(due) : null, amount, ...extra }));
const compute = (rows: PaymentTermsInstallmentInput[], base: string | null = "2026-01-01", orderTotal?: number) =>
  computePurchasePaymentTerms({ installments: rows, baseDate: base ? d(base) : null, baseKind: "ORDER_ISSUE_DATE", orderTotal });

describe("PMP — cálculo por pedido", () => {
  it("1. à vista só quando todas as parcelas vencem na data-base", () => {
    const r = compute(inst([["2026-01-01", 1000]]));
    assert.equal(r.status, "IDENTIFIED");
    if (r.status !== "IDENTIFIED") return;
    assert.equal(r.label, "À vista");
    assert.equal(r.pmpDays, 0);
    assert.equal(formatPmpDays(r.pmpDays), "PMP: 0 dias");
  });

  it("2. parcela única de 28 dias (Exemplo A)", () => {
    const r = compute(inst([["2026-01-29", 10000]]));
    assert.equal(r.status === "IDENTIFIED" && r.label, "28 dias");
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 28);
  });

  it("3. 30/60", () => {
    const r = compute(inst([["2026-01-31", 500], ["2026-03-02", 500]]));
    assert.equal(r.status === "IDENTIFIED" && r.label, "30/60");
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 45);
  });

  it("4. 30/60/90 iguais (Exemplo B) → 60", () => {
    const r = compute(inst([["2026-01-31", 3000], ["2026-03-02", 3000], ["2026-04-01", 3000]]), "2026-01-01", 9000);
    assert.equal(r.status === "IDENTIFIED" && r.label, "30/60/90");
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 60);
    assert.deepEqual(r.status === "IDENTIFIED" && r.warnings, []);
  });

  it("5. parcelas de valores diferentes (Exemplo C) → 69", () => {
    const r = compute(inst([["2026-01-31", 2000], ["2026-03-02", 3000], ["2026-04-01", 5000]]));
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 69);
    assert.equal(formatPmpDays(r.status === "IDENTIFIED" ? r.pmpDays : null), "PMP: 69 dias");
  });

  it("6/7/8. atravessa mês, ano e ano bissexto em dias corridos", () => {
    assert.equal(calendarDaysBetween(d("2026-01-31"), d("2026-03-02")), 30);
    assert.equal(calendarDaysBetween(d("2026-12-15"), d("2027-01-14")), 30);
    assert.equal(calendarDaysBetween(d("2028-02-01"), d("2028-03-01")), 29, "2028 é bissexto");
    assert.equal(calendarDaysBetween(d("2027-02-01"), d("2027-03-01")), 28);
  });

  it("hora e fuso não alteram a contagem (data de calendário)", () => {
    const r = computePurchasePaymentTerms({
      installments: [{ index: 0, dueDate: new Date("2026-01-29T23:59:00.000Z"), amount: 10 }],
      baseDate: new Date("2026-01-01T00:00:01.000Z"),
      baseKind: "ORDER_ISSUE_DATE",
    });
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 28);
  });

  it("9. datas inválidas → não identificado", () => {
    const r = compute([{ index: 0, dueDate: new Date("x"), amount: 10 }]);
    assert.equal(r.status === "NOT_IDENTIFIED" && r.reason, "INSTALLMENT_WITHOUT_DUE_DATE");
  });

  it("10. data-base ausente → não identificado (nunca 0)", () => {
    const r = compute(inst([["2026-01-31", 10]]), null);
    assert.equal(r.status === "NOT_IDENTIFIED" && r.reason, "MISSING_BASE_DATE");
  });

  it("11. parcela sem vencimento invalida o pedido inteiro (não calcula parcial)", () => {
    const r = compute(inst([["2026-01-31", 10], [null, 10]]));
    assert.equal(r.status === "NOT_IDENTIFIED" && r.reason, "INSTALLMENT_WITHOUT_DUE_DATE");
  });

  it("12. parcela sem valor, valor negativo e só zeros", () => {
    assert.equal((compute(inst([["2026-01-31", null]])) as { reason?: string }).reason, "INSTALLMENT_WITHOUT_AMOUNT");
    assert.equal((compute(inst([["2026-01-31", -5]])) as { reason?: string }).reason, "NEGATIVE_AMOUNT");
    assert.equal((compute(inst([["2026-01-31", 0]])) as { reason?: string }).reason, "NO_POSITIVE_AMOUNT");
    const z = compute(inst([["2026-01-31", 0], ["2026-03-02", 100]]));
    assert.equal(z.status === "IDENTIFIED" && z.label, "60 dias");
    assert.ok(z.warnings.includes("ZERO_AMOUNT_INSTALLMENT_IGNORED"));
  });

  it("13. soma das parcelas divergente do total do pedido é apontada (PMP pelas parcelas)", () => {
    const r = compute(inst([["2026-01-31", 900]]), "2026-01-01", 1000);
    assert.ok(r.warnings.includes("TOTAL_DIVERGENCE"));
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, 30);
  });

  it("14. pedido sem parcelas → não identificado, nunca à vista", () => {
    const r = compute([]);
    assert.equal(r.status, "NOT_IDENTIFIED");
    assert.equal(r.status === "NOT_IDENTIFIED" && r.reason, "NO_INSTALLMENTS");
    assert.equal(classifyPaymentTermsBucket(null), "NOT_IDENTIFIED");
  });

  it("15. prorrogação de título não altera o prazo negociado (parcelas do pedido são a fonte)", () => {
    const planned = inst([["2026-01-31", 100]]);
    const negotiated = compute(planned);
    // Mesmo pedido; o título foi prorrogado para 60 dias — a fonte negociada continua 30.
    const financial = compute(inst([["2026-03-02", 100]]));
    assert.equal(negotiated.status === "IDENTIFIED" && negotiated.pmpDays, 30);
    assert.equal(financial.status === "IDENTIFIED" && financial.pmpDays, 60);
  });

  it("pagamento antecipado e adiantamento ficam sinalizados", () => {
    const r = compute(inst([["2025-12-27", 100]], { generatesAdvance: true }));
    assert.equal(r.status === "IDENTIFIED" && r.pmpDays, -5);
    assert.ok(r.warnings.includes("DUE_BEFORE_BASE"));
    assert.ok(r.warnings.includes("ADVANCE_PAYMENT_FLAG"));
    assert.equal(classifyPaymentTermsBucket(-5), "AT_SIGHT");
  });

  it("lê as parcelas oficiais do payload Nomus (dd/MM/yyyy e moeda BR)", () => {
    const rows = parsePurchaseOrderPlannedInstallments({
      parcelas: [
        { dataVencimento: "16/10/2026", valorParcela: "1.136,68" },
        { dataVencimento: "30/10/2026", valorParcela: "1.136,68" },
      ],
    });
    const r = computePurchasePaymentTerms({ installments: rows, baseDate: d("2026-09-16"), baseKind: "ORDER_ISSUE_DATE" });
    assert.equal(r.status === "IDENTIFIED" && r.label, "30/44");
  });
});

describe("PMP — faixas, meta e consolidação", () => {
  it("faixas pelo PMP inteiro exibido", () => {
    assert.deepEqual(
      [0, 1, 29.4, 29.6, 59, 60, 89, 90, 140].map(classifyPaymentTermsBucket),
      ["AT_SIGHT", "D1_29", "D1_29", "D30_59", "D30_59", "D60_89", "D60_89", "D90_PLUS", "D90_PLUS"],
    );
  });

  it("meta é informativa e opcional", () => {
    assert.equal(paymentTermsMeetsTarget(60, null), null);
    assert.equal(paymentTermsMeetsTarget(59.6, 60), true);
    assert.equal(paymentTermsMeetsTarget(45, 60), false);
    assert.equal(paymentTermsMeetsTarget(null, 60), null);
  });

  it("16/20. PMP consolidado ponderado pelo valor, com não identificados na qualidade", () => {
    const a = compute(inst([["2026-01-31", 1000]])); // 30 dias, R$ 1.000
    const b = compute(inst([["2026-04-01", 9000]])); // 90 dias, R$ 9.000
    const pick = (r: typeof a) =>
      r.status === "IDENTIFIED"
        ? { installmentsTotal: r.installmentsTotal, weightedDaysAmount: r.weightedDaysAmount }
        : { installmentsTotal: null, weightedDaysAmount: null };
    const agg = aggregatePaymentTerms([pick(a), pick(b), pick(compute([]))]);
    assert.equal(agg.pmpDays, 84, "ponderado (média simples seria 60)");
    assert.equal(agg.orderCount, 3);
    assert.equal(agg.identifiedCount, 2);
    assert.equal(agg.notIdentifiedCount, 1);
    assert.equal(agg.identifiedPercent, 66.67);
    assert.equal(aggregatePaymentTerms([]).pmpDays, null);
  });
});
