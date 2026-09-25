/**
 * Prazo médio de recebimento — parser fail-closed (fallback), prazo por título
 * (emissão da NF-e → vencimento do CR), prazo por pedido, média geral ponderada
 * por valor líquido, qualidade por cobertura e apresentação do card.
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
  buildGrantedPaymentTermHelpText,
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

function order(
  id: string,
  totalNetValue: number,
  titles: GrantedPaymentTermTitleInput[],
  paymentTerms: string | null = null
): GrantedPaymentTermOrderInput {
  return { id, totalNetValue, paymentTerms, titles };
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

  it("resolução por pedido: títulos primeiro; condição comercial só como fallback; senão NONE", () => {
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
  });
});

describe("computeSalesOrderGrantedPaymentTermSummary — média geral ponderada por valor líquido", () => {
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
    assert.equal(summary.coveredSalesAmount, 100_000);
    assert.equal(summary.totalWeightedSalesAmount, 100_000);
    assert.equal(summary.coveredOrders, 2);
    assert.equal(summary.weightedPopulationOrders, 2);
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.zeroOrNegativeOrders, 0);
    assert.equal(summary.titlesUsed, 2);
    assert.equal(summary.sources.receivableTitles.orders, 2);
    assert.equal(summary.sources.receivableTitles.salesSharePercent, 100);
    assert.equal(summary.sources.receivableTitles.weightedAverageDays, 57);
    assert.equal(summary.sources.commercialTerms.orders, 0);
    assert.deepEqual(summary.unrecognizedTerms, []);
  });

  it("o peso entre pedidos é o valor líquido do pedido, não o valor dos títulos", () => {
    // Pedido A: valor líquido 10.000, títulos somam 12.000 (ex.: IPI na NF) — 30 dias.
    // Pedido B: valor líquido 90.000, títulos somam 60.000 (faturamento parcial) — 60 dias.
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

  it("mistura de fontes: títulos do CR + condição comercial de pedidos ainda sem NF", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 10_000, [title(30, 5_000), title(60, 5_000)]), // 45 via títulos
      order("b", 30_000, [], "28 DDL"), // 28 via condição
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

  it("cobertura: R$ 80.000 resolvido + R$ 20.000 sem título e sem condição → 80% (PARTIAL)", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 50_000, [title(30, 50_000)]),
      order("b", 30_000, [], "30"),
      order("c", 15_000, [], "boleto 30 dias"),
      order("d", 5_000, [], null),
    ]);
    assert.equal(summary.coveragePercent, 80);
    assert.equal(summary.orderCoveragePercent, 50);
    assert.equal(summary.quality, "PARTIAL");
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.coveredSalesAmount, 80_000);
    assert.equal(summary.uncoveredSalesAmount, 20_000);
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
    assert.equal(summary.totalWeightedSalesAmount, 10_000);
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

  it("FULL mostra dias + cobertura do valor vendido (tone info) e explica a fonte", () => {
    const summary = computeSalesOrderGrantedPaymentTermSummary([
      order("a", 30_000, [title(30, 30_000)]),
      order("b", 70_000, [], "60"),
    ]);
    const p = resolveGrantedPaymentTermCardPresentation(summary);
    assert.equal(p.quality, "FULL");
    assert.equal(p.value, "51,0 dias");
    assert.equal(p.valueSize, "default");
    assert.equal(p.subtitle, "Cobertura: 100,0% do valor vendido");
    assert.equal(p.tone, "info");
    assert.match(p.helperText, /emissão da NF-e/);
    assert.match(p.helperText, /vencimento dos títulos do Contas a Receber/);
    assert.match(p.helperText, /30\/60 = 45 dias/);
    assert.match(p.helperText, /Não mede atraso/);
    assert.match(p.helperText, /títulos do CR em 30,0% do valor vendido; condição comercial em 70,0%/);
    assert.doesNotMatch(p.helperText, /foram excluídos/);
  });

  it("PARTIAL mostra dias + cobertura parcial (warning) e explica exclusão", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "PARTIAL", weightedAverageDays: 47.84, coveragePercent: 89.4 })
    );
    assert.equal(p.value, "47,8 dias");
    assert.equal(p.subtitle, "Cobertura parcial: 89,4%");
    assert.equal(p.tone, "warning");
    assert.match(p.helperText, /foram excluídos da média/);
    assert.equal(buildGrantedPaymentTermHelpText(null, "FULL"), p.helperText.replace(/ Pedidos sem títulos de CR.*$/, ""));
  });

  it("LOW não exibe o número como KPI principal", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "LOW", weightedAverageDays: 47.84, coveragePercent: 54.1 })
    );
    assert.equal(p.quality, "LOW");
    assert.equal(p.value, "Cobertura insuficiente");
    assert.equal(p.valueSize, "text");
    assert.equal(p.subtitle, "Cobertura: 54,1%");
    assert.equal(p.tone, "warning");
    assert.doesNotMatch(p.value, /dias/);
  });

  it("UNAVAILABLE e falha do endpoint mostram Indisponível", () => {
    const unavailable = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: false, quality: "UNAVAILABLE", weightedAverageDays: null })
    );
    assert.equal(unavailable.value, "Indisponível");
    assert.equal(unavailable.subtitle, "Sem títulos ou condições de pagamento suficientes");
    assert.equal(unavailable.tone, "neutral");
    assert.equal(unavailable.valueSize, "text");

    const failed = resolveGrantedPaymentTermCardPresentation(null);
    assert.equal(failed.quality, "UNAVAILABLE");
    assert.equal(failed.value, "Indisponível");
    assert.equal(failed.subtitle, "Não foi possível carregar o indicador.");
    assert.equal(failed.tone, "neutral");
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
