/**
 * Prazo médio de recebimento — parser fail-closed (fallback), prazo por título
 * (emissão da NF-e → vencimento do CR), prazo por pedido, média geral dos pedidos
 * faturados ponderada por valor líquido, cobertura sobre o faturado, qualidade e
 * apresentação do card.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRANTED_PAYMENT_TERM_FULL_COVERAGE_PERCENT,
  GRANTED_PAYMENT_TERM_MAX_DAYS,
  GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS,
  GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS,
  GRANTED_PAYMENT_TERM_PARTIAL_COVERAGE_PERCENT,
  GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT,
  SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
  SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
  buildEmptySalesOrderGrantedPaymentTermSummary,
  GRANTED_PAYMENT_TERM_HELP_TEXT,
  GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT,
  SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_METHODOLOGY,
  buildGrantedPaymentTermInvoicedShareText,
  buildGrantedPaymentTermHelpText,
  buildSalesOrderGrantedPaymentTermMonthlySeries,
  describeGrantedPaymentTermMonthlyPoint,
  describeGrantedPaymentTermYearSummary,
  formatGrantedPaymentTermChartLabel,
  resolveGrantedPaymentTermChartDays,
  buildSalesOrderGrantedPaymentTermPeriodComparison,
  formatGrantedPaymentTermDeltaDays,
  resolveGrantedPaymentTermComparisonRanges,
  resolveGrantedPaymentTermPeriodCards,
  resolveGrantedPaymentTermTrend,
  civilDaysBetween,
  computeSalesOrderGrantedPaymentTermSummary,
  describeGrantedPaymentTermReason,
  formatGrantedPaymentTermCoverage,
  formatGrantedPaymentTermDays,
  normalizeGrantedPaymentTermText,
  parseGrantedPaymentTerm,
  resolveGrantedPaymentTermCardPresentation,
  resolveGrantedPaymentTermForOrder,
  resolveGrantedPaymentTermQuality,
  resolveOrderReceivableTermDays,
  resolveReceivableTitleTermDays,
  type GrantedPaymentTermDatedOrderInput,
  type GrantedPaymentTermOrderInput,
  type GrantedPaymentTermTitleInput,
  type SalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTerm.js";

const NF_ISSUE = new Date(2026, 8, 1, 10, 30); // 01/09/2026 10:30 (hora ignorada)

function d(day: number, month = 9, year = 2026, hour = 0): Date {
  return new Date(year, month - 1, day, hour);
}

function title(daysAfterIssue: number, amount: number, issue: Date = NF_ISSUE): GrantedPaymentTermTitleInput {
  const due = new Date(issue.getFullYear(), issue.getMonth(), issue.getDate() + daysAfterIssue, 12);
  return { dueDate: due, invoiceIssueDate: issue, amount };
}

/** Pedido FATURADO (com NF-e válida) por padrão. */
function order(
  id: string,
  totalNetValue: number,
  titles: GrantedPaymentTermTitleInput[],
  paymentTerms: string | null = null,
  invoiced = true
): GrantedPaymentTermOrderInput {
  return { id, totalNetValue, paymentTerms, invoiced, titles };
}

/** Pedido ainda SEM NF-e (não entra na média). */
function notInvoiced(id: string, totalNetValue: number, paymentTerms: string | null = null) {
  return order(id, totalNetValue, [], paymentTerms, false);
}

function summaryWith(
  overrides: Partial<SalesOrderGrantedPaymentTermSummary>
): SalesOrderGrantedPaymentTermSummary {
  return { ...buildEmptySalesOrderGrantedPaymentTermSummary(), ...overrides };
}

describe("parseGrantedPaymentTerm — condições reconhecidas (fallback)", () => {
  const recognizedCases: Array<[string, number, number[]]> = [
    ["À vista", 0, [0]],
    ["A vista", 0, [0]],
    ["AVISTA", 0, [0]],
    ["  à  VISTA ", 0, [0]],
    ["0 dias", 0, [0]],
    ["0 DDL", 0, [0]],
    ["0", 0, [0]],
    ["30", 30, [30]],
    ["30 dias", 30, [30]],
    ["30 DDL", 30, [30]],
    ["30ddl", 30, [30]],
    ["28 dd", 28, [28]],
    ["  30   dias ", 30, [30]],
    ["30/60", 45, [30, 60]],
    ["30 / 60", 45, [30, 60]],
    ["30/60/90", 60, [30, 60, 90]],
    ["28/56/84", 56, [28, 56, 84]],
    ["7/14/21/28", 17.5, [7, 14, 21, 28]],
    ["30-60-90", 60, [30, 60, 90]],
    ["30 - 60", 45, [30, 60]],
    ["30 + 60 + 90", 60, [30, 60, 90]],
    ["30+60", 45, [30, 60]],
    ["30/60/90 dias", 60, [30, 60, 90]],
    ["30/60 DDL", 45, [30, 60]],
    ["0/30", 15, [0, 30]],
    ["365", 365, [365]],
  ];

  for (const [input, expectedDays, expectedInstallments] of recognizedCases) {
    it(`"${input}" → ${expectedDays} dias`, () => {
      const parsed = parseGrantedPaymentTerm(input);
      assert.equal(parsed.recognized, true, JSON.stringify(parsed));
      assert.equal(parsed.averageDays, expectedDays);
      assert.deepEqual(parsed.installmentDays, expectedInstallments);
      assert.ok(Number.isFinite(parsed.averageDays));
    });
  }

  it("classifica o motivo das condições reconhecidas", () => {
    assert.equal(parseGrantedPaymentTerm("À vista").reason, "CASH");
    assert.equal(parseGrantedPaymentTerm("0 dias").reason, "CASH");
    assert.equal(parseGrantedPaymentTerm("30 DDL").reason, "SINGLE_TERM");
    assert.equal(parseGrantedPaymentTerm("30/60/90").reason, "INSTALLMENTS");
  });

  it("normalização só para comparação (acentos, caixa, espaços)", () => {
    assert.equal(normalizeGrantedPaymentTermText("  À   VISTA "), "a vista");
    assert.equal(normalizeGrantedPaymentTermText("30 / 60\t/ 90"), "30 / 60 / 90");
    assert.equal(normalizeGrantedPaymentTermText(null), "");
    assert.equal(parseGrantedPaymentTerm("30 / 60").normalized, "30 / 60");
  });
});

describe("parseGrantedPaymentTerm — fail-closed", () => {
  const rejectedCases: Array<[string | null | undefined, string]> = [
    [null, "MISSING"],
    [undefined, "MISSING"],
    ["", "MISSING"],
    ["   ", "MISSING"],
    ["texto aleatório", "UNRECOGNIZED_FORMAT"],
    ["boleto", "UNRECOGNIZED_FORMAT"],
    ["PIX", "UNRECOGNIZED_FORMAT"],
    ["50% entrada + 50% 30 dias", "AMBIGUOUS_WEIGHTS"],
    ["Entrada + 30/60", "AMBIGUOUS_WEIGHTS"],
    ["30 dias + sinal", "AMBIGUOUS_WEIGHTS"],
    ["30/60 + antecipação", "AMBIGUOUS_WEIGHTS"],
    ["50%/50%", "AMBIGUOUS_WEIGHTS"],
    ["-30", "NEGATIVE_DAYS"],
    ["30/-60", "NEGATIVE_DAYS"],
    ["366", "OUT_OF_RANGE"],
    ["999999", "OUT_OF_RANGE"],
    ["30/60/999", "OUT_OF_RANGE"],
    ["99999999999999999999", "OUT_OF_RANGE"],
    ["30/30", "NON_INCREASING_SEQUENCE"],
    ["60/30", "NON_INCREASING_SEQUENCE"],
    ["30+30+30", "NON_INCREASING_SEQUENCE"],
    ["30/60-90", "UNRECOGNIZED_FORMAT"],
    ["30,60", "UNRECOGNIZED_FORMAT"],
    ["30,5", "UNRECOGNIZED_FORMAT"],
    ["1x30", "UNRECOGNIZED_FORMAT"],
    ["3x 30/60/90", "UNRECOGNIZED_FORMAT"],
    ["30 dias boleto", "UNRECOGNIZED_FORMAT"],
    ["30 dias após entrega", "UNRECOGNIZED_FORMAT"],
    ["30 dfm", "UNRECOGNIZED_FORMAT"],
    ["COND 30", "UNRECOGNIZED_FORMAT"],
    ["à vista.", "UNRECOGNIZED_FORMAT"],
    ["30/60/", "UNRECOGNIZED_FORMAT"],
    ["/30", "UNRECOGNIZED_FORMAT"],
    ["+30", "UNRECOGNIZED_FORMAT"],
    ["30//60", "UNRECOGNIZED_FORMAT"],
    ["1e3", "UNRECOGNIZED_FORMAT"],
    ["Infinity", "UNRECOGNIZED_FORMAT"],
    ["NaN", "UNRECOGNIZED_FORMAT"],
    ["0x10", "UNRECOGNIZED_FORMAT"],
  ];

  for (const [input, reason] of rejectedCases) {
    it(`${JSON.stringify(input)} → não reconhecido (${reason})`, () => {
      const parsed = parseGrantedPaymentTerm(input);
      assert.equal(parsed.recognized, false);
      assert.equal(parsed.averageDays, null);
      assert.deepEqual(parsed.installmentDays, []);
      assert.equal(parsed.reason, reason);
    });
  }

  it("mais parcelas que o limite defensivo → TOO_MANY_INSTALLMENTS", () => {
    const tooMany = Array.from(
      { length: GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS + 1 },
      (_, i) => String(i + 1)
    ).join("/");
    assert.equal(parseGrantedPaymentTerm(tooMany).reason, "TOO_MANY_INSTALLMENTS");
    const atLimit = Array.from(
      { length: GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS },
      (_, i) => String(i + 1)
    ).join("/");
    assert.equal(parseGrantedPaymentTerm(atLimit).recognized, true);
  });

  it("limite superior de dias é exportado e respeitado", () => {
    assert.equal(parseGrantedPaymentTerm(String(GRANTED_PAYMENT_TERM_MAX_DAYS)).recognized, true);
    assert.equal(
      parseGrantedPaymentTerm(String(GRANTED_PAYMENT_TERM_MAX_DAYS + 1)).reason,
      "OUT_OF_RANGE"
    );
  });

  it("nunca produz NaN/Infinity nem extrai números soltos de texto livre", () => {
    const inputs = [
      "Infinity",
      "-Infinity",
      "NaN",
      "1e400",
      "1e3",
      "0x10",
      "30/60/",
      "/30",
      "30//60",
      "+30",
      "30+",
      " ",
      "\t30\n",
      "pedido 1234 boleto 30 dias",
      "cod 45 ref 90",
      "١٢",
      "30 dias 60 dias",
      "2026-09-25",
      "R$ 1.500,00 em 30 dias",
    ];
    for (const input of inputs) {
      const parsed = parseGrantedPaymentTerm(input);
      assert.ok(
        parsed.averageDays === null || Number.isFinite(parsed.averageDays),
        `averageDays inválido para ${JSON.stringify(input)}`
      );
      assert.ok(parsed.installmentDays.every((x) => Number.isFinite(x)));
      if (parsed.recognized) {
        assert.ok(parsed.installmentDays.length > 0);
      } else {
        assert.equal(parsed.averageDays, null);
      }
    }
    assert.equal(parseGrantedPaymentTerm("pedido 1234 boleto 30 dias").recognized, false);
    assert.equal(parseGrantedPaymentTerm("cod 45 ref 90").recognized, false);
    assert.equal(parseGrantedPaymentTerm("30 dias 60 dias").recognized, false);
  });

  it("descreve motivos em pt-BR", () => {
    assert.equal(describeGrantedPaymentTermReason("MISSING"), "Condição não informada");
    assert.match(describeGrantedPaymentTermReason("AMBIGUOUS_WEIGHTS"), /entrada/);
    assert.match(describeGrantedPaymentTermReason("OUT_OF_RANGE"), /365/);
  });
});

describe("prazo por título — emissão da NF-e → vencimento do CR", () => {
  it("civilDaysBetween ignora hora e conta dias de calendário", () => {
    assert.equal(civilDaysBetween(d(1), d(1)), 0);
    assert.equal(civilDaysBetween(d(1, 9, 2026, 23), d(2, 9, 2026, 0)), 1);
    assert.equal(civilDaysBetween(d(1, 9), d(1, 10)), 30);
    assert.equal(civilDaysBetween(d(1, 9), d(31, 10)), 60);
    assert.equal(civilDaysBetween(d(15, 12, 2025), d(14, 1, 2026)), 30);
    assert.equal(civilDaysBetween(d(10), d(5)), -5);
  });

  it("título válido: vencimento − emissão da NF-e", () => {
    assert.equal(resolveReceivableTitleTermDays(title(30, 1_000)), 30);
    assert.equal(resolveReceivableTitleTermDays(title(0, 1_000)), 0);
    assert.equal(
      resolveReceivableTitleTermDays({ dueDate: d(30, 9), invoiceIssueDate: d(1, 9, 2026, 18), amount: 10 }),
      29
    );
  });

  it("título inválido é ignorado: sem datas, valor não positivo, prazo negativo ou acima do limite", () => {
    assert.equal(resolveReceivableTitleTermDays({ dueDate: null, invoiceIssueDate: NF_ISSUE, amount: 100 }), null);
    assert.equal(resolveReceivableTitleTermDays({ dueDate: d(30), invoiceIssueDate: null, amount: 100 }), null);
    assert.equal(
      resolveReceivableTitleTermDays({ dueDate: new Date("x"), invoiceIssueDate: NF_ISSUE, amount: 100 }),
      null
    );
    assert.equal(resolveReceivableTitleTermDays(title(30, 0)), null);
    assert.equal(resolveReceivableTitleTermDays(title(30, -5)), null);
    assert.equal(resolveReceivableTitleTermDays(title(30, Number.NaN)), null);
    assert.equal(resolveReceivableTitleTermDays(title(-3, 100)), null);
    assert.equal(resolveReceivableTitleTermDays(title(GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS, 100)), 730);
    assert.equal(resolveReceivableTitleTermDays(title(GRANTED_PAYMENT_TERM_MAX_RECEIVABLE_DAYS + 1, 100)), null);
  });

  it("prazo do pedido = média dos títulos ponderada pelo valor do título", () => {
    assert.deepEqual(resolveOrderReceivableTermDays([title(30, 5_000), title(60, 5_000)]), {
      days: 45,
      titlesUsed: 2,
      titlesIgnored: 0,
    });
    assert.equal(resolveOrderReceivableTermDays([title(30, 9_000), title(60, 1_000)]).days, 33);
    assert.equal(resolveOrderReceivableTermDays([title(30, 100), title(60, 100), title(90, 100)]).days, 60);
    assert.deepEqual(resolveOrderReceivableTermDays([title(30, 100), title(-10, 100), title(30, 0)]), {
      days: 30,
      titlesUsed: 1,
      titlesIgnored: 2,
    });
    assert.deepEqual(resolveOrderReceivableTermDays([title(-1, 100)]), {
      days: null,
      titlesUsed: 0,
      titlesIgnored: 1,
    });
    assert.deepEqual(resolveOrderReceivableTermDays([]), { days: null, titlesUsed: 0, titlesIgnored: 0 });
  });

  it("resolução por pedido: só faturados; títulos primeiro; condição comercial como fallback; senão NONE", () => {
    const withTitles = resolveGrantedPaymentTermForOrder(order("a", 1_000, [title(28, 500), title(56, 500)], "30/60/90"));
    assert.equal(withTitles.source, "RECEIVABLE_TITLES");
    assert.equal(withTitles.days, 42);
    assert.equal(withTitles.reason, null);

    const fallback = resolveGrantedPaymentTermForOrder(order("b", 1_000, [], "30/60"));
    assert.equal(fallback.source, "COMMERCIAL_TERMS");
    assert.equal(fallback.days, 45);
    assert.equal(fallback.reason, "INSTALLMENTS");

    const invalidTitlesFallback = resolveGrantedPaymentTermForOrder(order("c", 1_000, [title(-5, 100)], "30"));
    assert.equal(invalidTitlesFallback.source, "COMMERCIAL_TERMS");
    assert.equal(invalidTitlesFallback.days, 30);
    assert.equal(invalidTitlesFallback.titlesIgnored, 1);

    const none = resolveGrantedPaymentTermForOrder(order("d", 1_000, [], null));
    assert.equal(none.source, "NONE");
    assert.equal(none.days, null);
    assert.equal(none.reason, "MISSING");

    const unrecognized = resolveGrantedPaymentTermForOrder(order("e", 1_000, [], "boleto 30 dias"));
    assert.equal(unrecognized.source, "NONE");
    assert.equal(unrecognized.reason, "UNRECOGNIZED_FORMAT");

    // Sem NF-e: não há recebimento a medir, mesmo com condição interpretável.
    const pending = resolveGrantedPaymentTermForOrder(notInvoiced("f", 1_000, "30/60"));
    assert.equal(pending.source, "NOT_INVOICED");
    assert.equal(pending.days, null);
    assert.equal(pending.reason, null);
  });
});

describe("computeSalesOrderGrantedPaymentTermSummary — média dos faturados ponderada por valor líquido", () => {
  it("A R$ 10.000 @ 30 + B R$ 90.000 @ 60 → 57 dias (não 45)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 10_000)]),
      order("b", 90_000, [title(60, 90_000)]),
    ]);
    assert.equal(summary.weightedAverageDays, 57);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.available, true);
    assert.equal(summary.coveragePercent, 100);
    assert.equal(summary.orderCoveragePercent, 100);
    assert.equal(summary.invoicedSharePercent, 100);
    assert.equal(summary.coveredSalesAmount, 100_000);
    assert.equal(summary.invoicedSalesAmount, 100_000);
    assert.equal(summary.positiveSalesAmount, 100_000);
    assert.equal(summary.coveredOrders, 2);
    assert.equal(summary.weightedPopulationOrders, 2);
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.zeroOrNegativeOrders, 0);
    assert.equal(summary.notInvoicedOrders, 0);
    assert.equal(summary.titlesUsed, 2);
    assert.equal(summary.sources.receivableTitles.orders, 2);
    assert.equal(summary.sources.receivableTitles.salesSharePercent, 100);
    assert.equal(summary.sources.receivableTitles.weightedAverageDays, 57);
    assert.equal(summary.sources.commercialTerms.orders, 0);
    assert.deepEqual(summary.unrecognizedTerms, []);
  });

  it("o peso entre pedidos é o valor líquido do pedido, não o valor dos títulos", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 12_000)]),
      order("b", 90_000, [title(60, 60_000)]),
    ]);
    assert.equal(summary.weightedAverageDays, 57);
  });

  it("R$ 10.000 @ 30/60 (45) + R$ 90.000 @ 30/60/90 (60) → 58,5 dias", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 5_000), title(60, 5_000)]),
      order("b", 90_000, [title(30, 30_000), title(60, 30_000), title(90, 30_000)]),
    ]);
    assert.equal(summary.weightedAverageDays, 58.5);
  });

  it("pedidos sem NF-e não entram na média nem na cobertura; participação do faturado é informada", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 10_000)]),
      order("b", 20_000, [title(60, 20_000)]),
      notInvoiced("c", 70_000, "30/60"), // ainda sem NF-e: fora da média mesmo com condição
    ]);
    assert.equal(summary.weightedAverageDays, 50);
    assert.equal(summary.coveragePercent, 100);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.weightedPopulationOrders, 2);
    assert.equal(summary.notInvoicedOrders, 1);
    assert.equal(summary.notInvoicedSalesAmount, 70_000);
    assert.equal(summary.invoicedSalesAmount, 30_000);
    assert.equal(summary.positiveSalesAmount, 100_000);
    assert.equal(summary.invoicedSharePercent, 30);
    assert.deepEqual(summary.unrecognizedTerms, []);
  });

  it("cenário 'todos os meses': 77,4% faturado não derruba a qualidade quando os faturados têm título", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 774, [title(40, 774)]),
      notInvoiced("b", 226, null),
    ]);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.coveragePercent, 100);
    assert.equal(summary.weightedAverageDays, 40);
    assert.ok(Math.abs(summary.invoicedSharePercent - 77.4) < 1e-9);
  });

  it("somente à vista (vencimento na emissão da NF-e) → 0 dias, disponível e FULL", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 5_000, [title(0, 5_000)]),
      order("b", 2_000, [], "À vista"),
    ]);
    assert.equal(summary.weightedAverageDays, 0);
    assert.equal(summary.available, true);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.sources.receivableTitles.orders, 1);
    assert.equal(summary.sources.commercialTerms.orders, 1);
  });

  it("mistura de fontes entre faturados: títulos do CR + condição comercial (faturado sem título)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 5_000), title(60, 5_000)]), // 45 via títulos
      order("b", 30_000, [], "28 DDL"), // faturado sem título → 28 via condição
      order("c", 2_000, [title(14, 2_000)]), // 14 via títulos
    ]);
    const expected = (10_000 * 45 + 30_000 * 28 + 2_000 * 14) / 42_000;
    assert.equal(summary.weightedAverageDays, expected);
    assert.equal(summary.coveragePercent, 100);
    assert.equal(summary.sources.receivableTitles.orders, 2);
    assert.equal(summary.sources.receivableTitles.salesAmount, 12_000);
    assert.ok(Math.abs(summary.sources.receivableTitles.salesSharePercent - (12_000 * 100) / 42_000) < 1e-9);
    assert.equal(summary.sources.commercialTerms.orders, 1);
    assert.equal(summary.sources.commercialTerms.salesAmount, 30_000);
    assert.equal(summary.sources.commercialTerms.weightedAverageDays, 28);
  });

  it("cobertura sobre o faturado: R$ 80.000 resolvido + R$ 20.000 faturado sem título/condição → 80% (PARTIAL)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 50_000, [title(30, 50_000)]),
      order("b", 30_000, [], "30"),
      order("c", 15_000, [], "boleto 30 dias"),
      order("d", 5_000, [], null),
      notInvoiced("e", 400_000, null), // não afeta a cobertura
    ]);
    assert.equal(summary.coveragePercent, 80);
    assert.equal(summary.orderCoveragePercent, 50);
    assert.equal(summary.quality, "PARTIAL");
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.coveredSalesAmount, 80_000);
    assert.equal(summary.uncoveredSalesAmount, 20_000);
    assert.equal(summary.invoicedSalesAmount, 100_000);
    assert.equal(summary.positiveSalesAmount, 500_000);
    assert.equal(summary.invoicedSharePercent, 20);
    assert.equal(summary.uncoveredOrders, 2);
    assert.deepEqual(
      summary.unrecognizedTerms.map((t) => [t.paymentTerms, t.orderCount, t.salesAmount, t.reason]),
      [
        ["boleto 30 dias", 1, 15_000, "UNRECOGNIZED_FORMAT"],
        [null, 1, 5_000, "MISSING"],
      ]
    );
    assert.equal(summary.unrecognizedTerms[1]!.reasonLabel, "Condição não informada");
  });

  it("valor zero e negativo não participam do peso (sem abs, sem zero no denominador)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 10_000)]),
      order("b", 0, [title(60, 100)]),
      order("c", -5_000, [title(90, 100)]),
      order("d", Number.NaN, [title(120, 100)]),
    ]);
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.weightedPopulationOrders, 1);
    assert.equal(summary.zeroOrNegativeOrders, 3);
    assert.equal(summary.totalOrders, 4);
    assert.equal(summary.invoicedSalesAmount, 10_000);
    assert.equal(summary.positiveSalesAmount, 10_000);
    assert.equal(summary.coveragePercent, 100);
  });

  it("títulos inválidos são contados e não viram prazo zero", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 10_000), { dueDate: null, invoiceIssueDate: NF_ISSUE, amount: 10 }]),
      order("b", 5_000, [title(-2, 5_000)], null),
    ]);
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.titlesUsed, 1);
    assert.equal(summary.titlesIgnored, 2);
    assert.equal(summary.uncoveredOrders, 1);
    assert.equal(summary.unrecognizedTerms[0]!.reason, "MISSING");
  });

  it("ausência completa → UNAVAILABLE", () => {
    const empty = computeSalesOrderGrantedPaymentTermSummary([]);
    assert.equal(empty.quality, "UNAVAILABLE");
    assert.equal(empty.available, false);
    assert.equal(empty.weightedAverageDays, null);
    assert.equal(empty.coveragePercent, 0);
    assert.equal(empty.totalOrders, 0);

    const onlyUncovered = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 5_000, [], "boleto"),
      order("b", 1_000, [], null),
    ]);
    assert.equal(onlyUncovered.quality, "UNAVAILABLE");
    assert.equal(onlyUncovered.available, false);
    assert.equal(onlyUncovered.weightedAverageDays, null);
    assert.equal(onlyUncovered.coveragePercent, 0);
    assert.equal(onlyUncovered.unrecognizedTerms.length, 2);
    assert.equal(onlyUncovered.unrecognizedTerms[0]!.paymentTerms, "boleto");

    const onlyNotInvoiced = computeSalesOrderGrantedPaymentTermSummary([notInvoiced("a", 5_000, "30")]);
    assert.equal(onlyNotInvoiced.quality, "UNAVAILABLE");
    assert.equal(onlyNotInvoiced.weightedPopulationOrders, 0);
    assert.equal(onlyNotInvoiced.notInvoicedOrders, 1);
    assert.equal(onlyNotInvoiced.invoicedSharePercent, 0);
    assert.equal(onlyNotInvoiced.positiveSalesAmount, 5_000);

    const onlyZero = computeSalesOrderGrantedPaymentTermSummary([order("a", 0, [title(30, 10)])]);
    assert.equal(onlyZero.quality, "UNAVAILABLE");
    assert.equal(onlyZero.zeroOrNegativeOrders, 1);
  });

  it("auditoria: top N de condições não resolvidas por valor vendido desc, agrupadas por texto", () => {
    const orders: GrantedPaymentTermOrderInput[] = [];
    for (let i = 0; i < GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT + 5; i += 1) {
      orders.push(order(`u${i}`, (i + 1) * 100, [], `cond ${i}`));
    }
    orders.push(order("dup1", 10, [], "cond 0"));
    orders.push(order("ok", 1_000, [title(30, 1_000)]));
    const summary = computeSalesOrderGrantedPaymentTermSummary(orders);
    assert.equal(summary.unrecognizedTerms.length, GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT);
    const amounts = summary.unrecognizedTerms.map((t) => t.salesAmount);
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    assert.equal(summary.unrecognizedTerms[0]!.salesAmount, 2_500);
    assert.equal(summary.uncoveredOrders, GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT + 6);
    const grouped = computeSalesOrderGrantedPaymentTermSummary(orders, { unrecognizedTopLimit: 100 });
    const cond0 = grouped.unrecognizedTerms.find((t) => t.paymentTerms === "cond 0")!;
    assert.equal(cond0.orderCount, 2);
    assert.equal(cond0.salesAmount, 110);
    const limited = computeSalesOrderGrantedPaymentTermSummary(orders, { unrecognizedTopLimit: 3 });
    assert.equal(limited.unrecognizedTerms.length, 3);
  });

  it("DTO expõe fonte e metodologia estáveis", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([order("a", 100, [title(30, 100)])]);
    assert.equal(summary.source, SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE);
    assert.match(summary.source, /NomusAccountsReceivable\.dueDate/);
    assert.match(summary.source, /NomusNfe\.xmlDhEmi/);
    assert.equal(summary.methodology, SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY);
    assert.match(summary.methodology, /emissão da NF-e/);
    assert.match(summary.methodology, /vencimento/);
    assert.match(summary.methodology, /pedidos faturados/);
    assert.match(summary.methodology, /totalNetValue > 0/);
    assert.match(summary.methodology, /Não considera liquidação nem atraso/);
  });

  it("precisão interna preservada (sem arredondar a matemática)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 1_234.56, [title(30, 1_234.56)]),
      order("b", 2_345.67, [title(45, 2_345.67)]),
      order("c", 3_456.78, [title(30, 1_000), title(60, 1_000), title(90, 1_000)]),
    ]);
    const expected =
      (1_234.56 * 30 + 2_345.67 * 45 + 3_456.78 * 60) / (1_234.56 + 2_345.67 + 3_456.78);
    assert.equal(summary.weightedAverageDays, expected);
    assert.ok(Number.isFinite(summary.weightedAverageDays));
  });
});

describe("resolveGrantedPaymentTermQuality — bordas", () => {
  it("94,9% → PARTIAL; 95% → FULL; 79,9% → LOW; 80% → PARTIAL; 0% → UNAVAILABLE", () => {
    assert.equal(resolveGrantedPaymentTermQuality(94.9), "PARTIAL");
    assert.equal(resolveGrantedPaymentTermQuality(95), "FULL");
    assert.equal(resolveGrantedPaymentTermQuality(100), "FULL");
    assert.equal(resolveGrantedPaymentTermQuality(79.9), "LOW");
    assert.equal(resolveGrantedPaymentTermQuality(80), "PARTIAL");
    assert.equal(resolveGrantedPaymentTermQuality(0.1), "LOW");
    assert.equal(resolveGrantedPaymentTermQuality(0), "UNAVAILABLE");
    assert.equal(resolveGrantedPaymentTermQuality(Number.NaN), "UNAVAILABLE");
    assert.equal(GRANTED_PAYMENT_TERM_FULL_COVERAGE_PERCENT, 95);
    assert.equal(GRANTED_PAYMENT_TERM_PARTIAL_COVERAGE_PERCENT, 80);
  });

  it("bordas via valores reais (sem erro de ponto flutuante)", () => {
    const at = (covered: number, uncovered: number) =>
      computeSalesOrderGrantedPaymentTermSummary([
        order("a", covered, [title(30, covered)]),
        order("b", uncovered, [], "boleto"),
      ]);
    assert.equal(at(949, 51).quality, "PARTIAL");
    assert.equal(at(950, 50).quality, "FULL");
    assert.equal(at(799, 201).quality, "LOW");
    assert.equal(at(800, 200).quality, "PARTIAL");
    assert.equal(at(95_000, 5_000).coveragePercent, 95);
    assert.equal(at(80_000, 20_000).coveragePercent, 80);
  });
});

describe("apresentação do card", () => {
  it("formatação com 1 casa decimal", () => {
    assert.equal(formatGrantedPaymentTermDays(47.84), "47,8 dias");
    assert.equal(formatGrantedPaymentTermDays(0), "0,0 dias");
    assert.equal(formatGrantedPaymentTermDays(120.26), "120,3 dias");
    assert.equal(formatGrantedPaymentTermDays(null), "—");
    assert.equal(formatGrantedPaymentTermDays(Number.NaN), "—");
    assert.equal(formatGrantedPaymentTermCoverage(96.44), "96,4%");
    assert.equal(formatGrantedPaymentTermCoverage(100), "100,0%");
    assert.equal(formatGrantedPaymentTermCoverage(undefined), "—");
  });

  it("FULL mostra dias e cobertura do faturado; participação do faturado e fonte ficam no tooltip", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 30_000, [title(30, 30_000)]),
      order("b", 70_000, [], "60"),
      notInvoiced("c", 100_000, null),
    ]);
    const p = resolveGrantedPaymentTermCardPresentation(summary);
    assert.equal(p.quality, "FULL");
    assert.equal(p.value, "51,0 dias");
    assert.equal(p.valueSize, "default");
    assert.equal(p.subtitle, "Cobertura: 100,0% do valor faturado");
    assert.equal("footnote" in p, false, "sem linha extra no card");
    assert.equal(p.tone, "info");
    assert.ok(
      p.helperText.startsWith(
        "Faturado: 50,0% do valor vendido (pedidos sem NF-e ainda não entram na média).\n" +
          "Fonte: títulos do CR em 30,0% do valor faturado; condição comercial em 70,0%.\n\n"
      ),
      p.helperText
    );
    assert.ok(p.helperText.endsWith(GRANTED_PAYMENT_TERM_HELP_TEXT));
    assert.match(p.helperText, /emissão da NF-e/);
    assert.match(p.helperText, /vencimento dos títulos do Contas a Receber/);
    assert.match(p.helperText, /Pedidos sem NF-e não entram/);
    assert.match(p.helperText, /30\/60 = 45 dias/);
    assert.match(p.helperText, /Não mede atraso/);
    assert.doesNotMatch(p.helperText, /foram excluídos/);
    assert.doesNotMatch(p.helperText, /não confiável/);
  });

  it("PARTIAL mostra dias + cobertura parcial do faturado (warning); tooltip traz faturado e exclusão", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({
        available: true,
        quality: "PARTIAL",
        weightedAverageDays: 47.84,
        coveragePercent: 89.4,
        positiveSalesAmount: 1_000,
        invoicedSharePercent: 77.4,
      })
    );
    assert.equal(p.value, "47,8 dias");
    assert.equal(p.subtitle, "Cobertura parcial: 89,4% do faturado");
    assert.equal(p.tone, "warning");
    assert.ok(p.helperText.startsWith("Faturado: 77,4% do valor vendido"));
    assert.ok(p.helperText.endsWith(GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT));
    assert.match(p.helperText, /foram excluídos da média/);
    assert.equal(buildGrantedPaymentTermHelpText(null, "PARTIAL"), GRANTED_PAYMENT_TERM_PARTIAL_HELP_TEXT);
    assert.equal(buildGrantedPaymentTermHelpText(null, "FULL"), GRANTED_PAYMENT_TERM_HELP_TEXT);
  });

  it("LOW não exibe o número como KPI principal, mas o expõe no tooltip como não confiável", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({
        available: true,
        quality: "LOW",
        weightedAverageDays: 47.84,
        coveragePercent: 54.1,
        coveredSalesAmount: 541,
        invoicedSalesAmount: 1_000,
        positiveSalesAmount: 1_000,
        invoicedSharePercent: 100,
      })
    );
    assert.equal(p.quality, "LOW");
    assert.equal(p.value, "Cobertura insuficiente");
    assert.equal(p.valueSize, "text");
    assert.equal(p.subtitle, "Cobertura: 54,1% do faturado");
    assert.equal(p.tone, "warning");
    assert.doesNotMatch(p.value, /dias/);
    assert.match(p.helperText, /Prazo calculado só sobre a parte coberta: 47,8 dias \(não confiável\)/);
  });

  it("UNAVAILABLE distingue 'sem faturados' de 'sem títulos'; falha do endpoint mostra Indisponível", () => {
    const noInvoices = resolveGrantedPaymentTermCardPresentation(
      computeSalesOrderGrantedPaymentTermSummary([notInvoiced("a", 5_000, "30")])
    );
    assert.equal(noInvoices.value, "Indisponível");
    assert.equal(noInvoices.subtitle, "Sem pedidos faturados no filtro");
    assert.ok(noInvoices.helperText.startsWith("Faturado: 0,0% do valor vendido"));
    assert.equal(noInvoices.tone, "neutral");

    const noTitles = resolveGrantedPaymentTermCardPresentation(
      computeSalesOrderGrantedPaymentTermSummary([order("a", 5_000, [], "boleto")])
    );
    assert.equal(noTitles.value, "Indisponível");
    assert.equal(noTitles.subtitle, "Sem títulos ou condições de pagamento suficientes");
    assert.ok(noTitles.helperText.startsWith("Faturado: 100,0% do valor vendido"));
    assert.doesNotMatch(noTitles.helperText, /Fonte:/, "sem cobertura não há fonte a informar");
    assert.equal(noTitles.valueSize, "text");

    const empty = resolveGrantedPaymentTermCardPresentation(buildEmptySalesOrderGrantedPaymentTermSummary());
    assert.equal(empty.subtitle, "Sem títulos ou condições de pagamento suficientes");
    assert.equal(empty.helperText, GRANTED_PAYMENT_TERM_HELP_TEXT);

    const failed = resolveGrantedPaymentTermCardPresentation(null);
    assert.equal(failed.quality, "UNAVAILABLE");
    assert.equal(failed.value, "Indisponível");
    assert.equal(failed.subtitle, "Não foi possível carregar o indicador.");
    assert.equal(failed.helperText, GRANTED_PAYMENT_TERM_HELP_TEXT);
    assert.equal(failed.tone, "neutral");
    assert.equal(buildGrantedPaymentTermInvoicedShareText(null), null);
    assert.equal(
      buildGrantedPaymentTermInvoicedShareText(buildEmptySalesOrderGrantedPaymentTermSummary()),
      null
    );
  });

  it("DTO inconsistente (FULL sem dias) cai em Indisponível, nunca em número falso", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "FULL", weightedAverageDays: null, coveragePercent: 100 })
    );
    assert.equal(p.quality, "UNAVAILABLE");
    assert.equal(p.value, "Indisponível");
  });

  it("0 dias e 100+ dias formatam corretamente", () => {
    const zero = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "FULL", weightedAverageDays: 0, coveragePercent: 100 })
    );
    assert.equal(zero.value, "0,0 dias");
    const long = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "FULL", weightedAverageDays: 132.49, coveragePercent: 100 })
    );
    assert.equal(long.value, "132,5 dias");
  });
});

describe("série mensal do prazo de recebimento (tela Resultado)", () => {
  function dated(
    id: string,
    issueDate: Date | null,
    totalNetValue: number,
    titles: GrantedPaymentTermTitleInput[],
    paymentTerms: string | null = null,
    invoiced = true
  ): GrantedPaymentTermDatedOrderInput {
    return { id, issueDate, totalNetValue, paymentTerms, invoiced, titles };
  }

  it("12 meses por mês de emissão, ano filtrado × anterior, com o MESMO cálculo do card", () => {
    const january = [
      dated("a", d(5, 1, 2026), 10_000, [title(30, 10_000)]),
      dated("b", d(20, 1, 2026), 30_000, [title(60, 30_000)]),
    ];
    const current = [
      ...january,
      dated("c", d(3, 9, 2026), 5_000, [], null, false), // setembro: ainda sem NF-e
    ];
    const previous = [dated("p", d(10, 1, 2025), 8_000, [title(28, 8_000)])];
    const series = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: current,
      previousYearOrders: previous,
    });

    assert.equal(series.year, 2026);
    assert.equal(series.previousYear, 2025);
    assert.equal(series.monthBasis, "SalesOrder.issueDate");
    assert.equal(series.methodology, SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_METHODOLOGY);
    assert.equal(series.rows.length, 12);
    assert.deepEqual(
      series.rows.map((r) => r.month),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    assert.deepEqual(
      series.rows.map((r) => r.monthLabel),
      ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    );

    const jan = series.rows[0]!;
    assert.equal(jan.current.chartDays, (10_000 * 30 + 30_000 * 60) / 40_000);
    assert.equal(jan.previous.chartDays, 28);
    // Paridade com o card do mês: mesmo número que o card filtrado em jan/2026.
    const card = computeSalesOrderGrantedPaymentTermSummary(january);
    assert.equal(jan.current.weightedAverageDays, card.weightedAverageDays);
    assert.equal(jan.current.coveragePercent, card.coveragePercent);
    assert.equal(jan.current.invoicedOrders, 2);
    assert.equal(jan.current.totalOrders, 2);

    const sep = series.rows[8]!;
    assert.equal(sep.current.chartDays, null);
    assert.equal(sep.current.totalOrders, 1);
    assert.equal(sep.current.invoicedOrders, 0);
    assert.equal(describeGrantedPaymentTermMonthlyPoint(sep.current), "Sem pedidos faturados");

    const feb = series.rows[1]!;
    assert.equal(feb.current.chartDays, null);
    assert.equal(describeGrantedPaymentTermMonthlyPoint(feb.current), "Sem pedidos");

    // Resumo anual = população inteira do ano (inclui o pedido sem NF-e na participação).
    assert.equal(series.currentYearSummary.weightedAverageDays, 52.5);
    assert.equal(series.currentYearSummary.notInvoicedOrders, 1);
    assert.ok(Math.abs(series.currentYearSummary.invoicedSharePercent - (40_000 * 100) / 45_000) < 1e-9);
    assert.equal(series.previousYearSummary.weightedAverageDays, 28);
  });

  it("mês com cobertura baixa não vira barra (regra do card) e o tooltip explica; PARTIAL vira barra", () => {
    const series = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: [
        dated("a", d(1, 3, 2026), 100, [title(30, 100)]),
        dated("b", d(2, 3, 2026), 900, [], "boleto"),
        dated("c", d(1, 4, 2026), 850, [title(40, 850)]),
        dated("d", d(2, 4, 2026), 150, [], null),
      ],
      previousYearOrders: [],
    });
    const mar = series.rows[2]!.current;
    assert.equal(mar.quality, "LOW");
    assert.equal(mar.chartDays, null);
    assert.equal(mar.weightedAverageDays, 30, "prazo calculado fica disponível para auditoria");
    assert.equal(describeGrantedPaymentTermMonthlyPoint(mar), "Cobertura insuficiente (10,0% do faturado)");

    const apr = series.rows[3]!.current;
    assert.equal(apr.quality, "PARTIAL");
    assert.equal(apr.chartDays, 40);
    assert.equal(
      describeGrantedPaymentTermMonthlyPoint(apr),
      "40,0 dias · cobertura 85,0% do faturado (parcial) · 2 pedido(s) faturado(s)"
    );
  });

  it("ignora datas inválidas e de outro ano na distribuição mensal", () => {
    const series = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders: [
        dated("ok", d(15, 6, 2026), 1_000, [title(30, 1_000)]),
        dated("sem-data", null, 1_000, [title(90, 1_000)]),
        dated("data-invalida", new Date("x"), 1_000, [title(90, 1_000)]),
        dated("outro-ano", d(15, 6, 2024), 1_000, [title(90, 1_000)]),
      ],
      previousYearOrders: [],
    });
    const monthsWithOrders = series.rows.filter((r) => r.current.totalOrders > 0);
    assert.equal(monthsWithOrders.length, 1);
    assert.equal(monthsWithOrders[0]!.month, 6);
    assert.equal(monthsWithOrders[0]!.current.chartDays, 30);
    assert.equal(series.rows.every((r) => r.previous.totalOrders === 0), true);
  });

  it("rótulos da barra, resumo anual e regra de exibição", () => {
    assert.equal(formatGrantedPaymentTermChartLabel(35.94), "36");
    assert.equal(formatGrantedPaymentTermChartLabel(0), "0");
    assert.equal(formatGrantedPaymentTermChartLabel(null), "");
    assert.equal(formatGrantedPaymentTermChartLabel(Number.NaN), "");

    const full = computeSalesOrderGrantedPaymentTermSummary([order("a", 100, [title(45, 100)])]);
    assert.equal(resolveGrantedPaymentTermChartDays(full), 45);
    assert.equal(describeGrantedPaymentTermYearSummary(full), "45,0 dias");

    const low = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 100, [title(30, 100)]),
      order("b", 900, [], "boleto"),
    ]);
    assert.equal(resolveGrantedPaymentTermChartDays(low), null);
    assert.equal(describeGrantedPaymentTermYearSummary(low), "Cobertura insuficiente");

    const empty = computeSalesOrderGrantedPaymentTermSummary([]);
    assert.equal(resolveGrantedPaymentTermChartDays(empty), null);
    assert.equal(describeGrantedPaymentTermYearSummary(empty), "Indisponível");
  });
});

describe("período selecionado × mesmo período do ano anterior (cards do Resultado)", () => {
  function datedOrder(
    id: string,
    issueDate: Date,
    totalNetValue: number,
    titles: GrantedPaymentTermTitleInput[]
  ): GrantedPaymentTermDatedOrderInput {
    return { id, issueDate, totalNetValue, paymentTerms: null, invoiced: true, titles };
  }
  const civil = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const rangeKeys = (input: { year: number; month: number | null; referenceDate: Date }) => {
    const ranges = resolveGrantedPaymentTermComparisonRanges(input);
    return {
      current: [civil(ranges.current.from), civil(ranges.current.to)],
      previous: [civil(ranges.previous.from), civil(ranges.previous.to)],
    };
  };
  const REFERENCE = new Date(2026, 8, 25, 15, 0); // 25/09/2026 15:00

  it("sem Mês: acumulado do ano até a data de referência × as mesmas datas do ano anterior", () => {
    assert.deepEqual(rangeKeys({ year: 2026, month: null, referenceDate: REFERENCE }), {
      current: ["2026-01-01", "2026-09-25"],
      previous: ["2025-01-01", "2025-09-25"],
    });
  });

  it("ano encerrado e ano futuro ficam inteiros", () => {
    assert.deepEqual(rangeKeys({ year: 2025, month: null, referenceDate: REFERENCE }), {
      current: ["2025-01-01", "2025-12-31"],
      previous: ["2024-01-01", "2024-12-31"],
    });
    assert.deepEqual(rangeKeys({ year: 2027, month: null, referenceDate: REFERENCE }), {
      current: ["2027-01-01", "2027-12-31"],
      previous: ["2026-01-01", "2026-12-31"],
    });
  });

  it("com Mês: mês em andamento corta na data; mês encerrado inteiro; 29/02 vira 28/02", () => {
    assert.deepEqual(rangeKeys({ year: 2026, month: 9, referenceDate: REFERENCE }), {
      current: ["2026-09-01", "2026-09-25"],
      previous: ["2025-09-01", "2025-09-25"],
    });
    assert.deepEqual(rangeKeys({ year: 2026, month: 2, referenceDate: REFERENCE }), {
      current: ["2026-02-01", "2026-02-28"],
      previous: ["2025-02-01", "2025-02-28"],
    });
    assert.deepEqual(rangeKeys({ year: 2024, month: 2, referenceDate: new Date(2024, 1, 29, 9) }), {
      current: ["2024-02-01", "2024-02-29"],
      previous: ["2023-02-01", "2023-02-28"],
    });
    assert.deepEqual(rangeKeys({ year: 2028, month: null, referenceDate: new Date(2028, 1, 29) }), {
      current: ["2028-01-01", "2028-02-29"],
      previous: ["2027-01-01", "2027-02-28"],
    });
  });

  it("acumulado: mesmos pedidos do período, mesmo cálculo do card; menos dias = melhor", () => {
    const inPeriod = [
      datedOrder("a", d(10, 3, 2026), 10_000, [title(40, 10_000)]),
      datedOrder("b", d(25, 9, 2026, 23), 10_000, [title(40, 10_000)]), // último dia, inclusivo
    ];
    const current = [
      ...inPeriod,
      datedOrder("c", d(26, 9, 2026), 10_000, [title(90, 10_000)]), // depois da data de referência
      datedOrder("e", d(2, 10, 2026), 10_000, [title(120, 10_000)]),
    ];
    const previous = [
      datedOrder("p1", d(5, 5, 2025), 20_000, [title(45, 20_000)]),
      datedOrder("p2", d(25, 9, 2025), 20_000, [title(45, 20_000)]),
      datedOrder("p3", d(26, 9, 2025), 20_000, [title(200, 20_000)]), // fora das mesmas datas
    ];
    const comparison = buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: 2026,
      month: null,
      referenceDate: REFERENCE,
      currentYearOrders: current,
      previousYearOrders: previous,
    });

    assert.equal(comparison.basis, "SalesOrder.issueDate");
    assert.equal(comparison.month, null);
    assert.deepEqual(
      [comparison.current.from, comparison.current.to, comparison.current.label],
      ["2026-01-01", "2026-09-25", "01/01 a 25/09/2026"]
    );
    assert.deepEqual(
      [comparison.previous.from, comparison.previous.to, comparison.previous.label],
      ["2025-01-01", "2025-09-25", "01/01 a 25/09/2025"]
    );
    assert.deepEqual(comparison.current.summary, computeSalesOrderGrantedPaymentTermSummary(inPeriod));
    assert.equal(comparison.current.displayDays, 40);
    assert.equal(comparison.previous.displayDays, 45);
    assert.equal(comparison.deltaDays, -5);
    assert.equal(comparison.trend, "BETTER");

    const cards = resolveGrantedPaymentTermPeriodCards(comparison);
    assert.equal(cards.current.label, "Prazo médio 2026 · acumulado");
    assert.equal(cards.current.value, formatGrantedPaymentTermDays(40));
    assert.equal(cards.current.valueSize, "default");
    assert.equal(cards.current.subtitle, "01/01 a 25/09/2026 · cobertura 100,0% do faturado");
    assert.equal(cards.current.badgeLabel, "−5,0 dias vs 2025 · melhor");
    assert.equal(cards.current.badgeTone, "success");
    assert.equal(cards.current.tone, "success");
    assert.match(cards.current.helperText, /menos dias = recebimento mais rápido = melhor/);
    assert.equal(cards.previous.label, "Mesmo período 2025");
    assert.equal(cards.previous.value, formatGrantedPaymentTermDays(45));
    assert.equal(cards.previous.badgeLabel, "Base da comparação");
    assert.equal(cards.previous.tone, "neutral");
  });

  it("Mês selecionado: só o mês (cortado na data); prazo maior que o do ano anterior = pior", () => {
    const comparison = buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: 2026,
      month: 9,
      referenceDate: REFERENCE,
      currentYearOrders: [
        datedOrder("a", d(10, 3, 2026), 10_000, [title(10, 10_000)]), // outro mês
        datedOrder("b", d(20, 9, 2026), 10_000, [title(50, 10_000)]),
      ],
      previousYearOrders: [
        datedOrder("p", d(10, 9, 2025), 10_000, [title(45, 10_000)]),
        datedOrder("p2", d(28, 9, 2025), 10_000, [title(10, 10_000)]), // depois de 25/09
      ],
    });
    assert.equal(comparison.month, 9);
    assert.equal(comparison.current.label, "01/09 a 25/09/2026");
    assert.equal(comparison.previous.label, "01/09 a 25/09/2025");
    assert.equal(comparison.deltaDays, 5);
    assert.equal(comparison.trend, "WORSE");
    const cards = resolveGrantedPaymentTermPeriodCards(comparison);
    assert.equal(cards.current.label, "Prazo médio Set/2026");
    assert.equal(cards.current.badgeLabel, "+5,0 dias vs 2025 · pior");
    assert.equal(cards.current.badgeTone, "danger");
  });

  it("sem base de comparação e cobertura baixa não viram número", () => {
    const withoutPrevious = buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: 2026,
      month: null,
      referenceDate: REFERENCE,
      currentYearOrders: [datedOrder("a", d(10, 3, 2026), 10_000, [title(40, 10_000)])],
      previousYearOrders: [],
    });
    assert.equal(withoutPrevious.previous.displayDays, null);
    assert.equal(withoutPrevious.deltaDays, null);
    assert.equal(withoutPrevious.trend, "UNAVAILABLE");
    const cards = resolveGrantedPaymentTermPeriodCards(withoutPrevious);
    assert.equal(cards.current.badgeLabel, "Sem base de comparação");
    assert.equal(cards.current.badgeTone, "neutral");
    assert.equal(cards.previous.value, "Indisponível");
    assert.equal(cards.previous.valueSize, "text");
    assert.equal(cards.previous.subtitle, "01/01 a 25/09/2025 · sem pedidos faturados");

    const lowCoverage = buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: 2026,
      month: null,
      referenceDate: REFERENCE,
      currentYearOrders: [
        datedOrder("a", d(10, 3, 2026), 10_000, [title(40, 10_000)]),
        datedOrder("b", d(11, 3, 2026), 90_000, []), // faturado sem título: fora da cobertura
      ],
      previousYearOrders: [datedOrder("p", d(10, 3, 2025), 10_000, [title(45, 10_000)])],
    });
    assert.equal(lowCoverage.current.summary.quality, "LOW");
    assert.equal(lowCoverage.current.displayDays, null);
    assert.equal(lowCoverage.trend, "UNAVAILABLE");
    assert.equal(resolveGrantedPaymentTermPeriodCards(lowCoverage).current.value, "Cobertura insuficiente");
  });

  it("tendência e delta com a mesma precisão exibida (1 casa)", () => {
    assert.equal(resolveGrantedPaymentTermTrend(-0.04), "EQUAL");
    assert.equal(resolveGrantedPaymentTermTrend(0.04), "EQUAL");
    assert.equal(resolveGrantedPaymentTermTrend(-0.06), "BETTER");
    assert.equal(resolveGrantedPaymentTermTrend(0.06), "WORSE");
    assert.equal(resolveGrantedPaymentTermTrend(null), "UNAVAILABLE");
    assert.equal(resolveGrantedPaymentTermTrend(Number.NaN), "UNAVAILABLE");
    assert.equal(formatGrantedPaymentTermDeltaDays(-5), "−5,0 dias");
    assert.equal(formatGrantedPaymentTermDeltaDays(3.24), "+3,2 dias");
    assert.equal(formatGrantedPaymentTermDeltaDays(0), "0,0 dias");
    assert.equal(formatGrantedPaymentTermDeltaDays(-0.04), "0,0 dias");
    assert.equal(formatGrantedPaymentTermDeltaDays(null), "—");

    const equal = buildSalesOrderGrantedPaymentTermPeriodComparison({
      year: 2026,
      month: null,
      referenceDate: REFERENCE,
      currentYearOrders: [datedOrder("a", d(10, 3, 2026), 10_000, [title(30, 10_000)])],
      previousYearOrders: [datedOrder("p", d(10, 3, 2025), 10_000, [title(30, 10_000)])],
    });
    assert.equal(equal.trend, "EQUAL");
    const cards = resolveGrantedPaymentTermPeriodCards(equal);
    assert.equal(cards.current.badgeLabel, "Igual a 2025");
    assert.equal(cards.current.badgeTone, "info");
  });

  it("série mensal traz a comparação (Mês/data da tela); sem data = ano inteiro", () => {
    const currentYearOrders = [datedOrder("a", d(10, 9, 2026), 10_000, [title(40, 10_000)])];
    const previousYearOrders = [datedOrder("p", d(10, 9, 2025), 10_000, [title(45, 10_000)])];
    const series = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders,
      previousYearOrders,
      month: 9,
      referenceDate: REFERENCE,
    });
    assert.deepEqual(
      series.periodComparison,
      buildSalesOrderGrantedPaymentTermPeriodComparison({
        year: 2026,
        month: 9,
        referenceDate: REFERENCE,
        currentYearOrders,
        previousYearOrders,
      })
    );
    // Barras continuam 12 meses (o Mês só afeta os cards).
    assert.equal(series.rows.length, 12);
    const wholeYear = buildSalesOrderGrantedPaymentTermMonthlySeries({
      year: 2026,
      currentYearOrders,
      previousYearOrders,
    });
    assert.equal(wholeYear.periodComparison.month, null);
    assert.equal(wholeYear.periodComparison.current.to, "2026-12-31");
    assert.equal(wholeYear.periodComparison.previous.to, "2025-12-31");
  });
});
