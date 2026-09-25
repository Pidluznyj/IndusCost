/**
 * Prazo médio concedido — parser fail-closed, ponderação por valor líquido,
 * qualidade por cobertura e apresentação do card.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRANTED_PAYMENT_TERM_FULL_COVERAGE_PERCENT,
  GRANTED_PAYMENT_TERM_MAX_DAYS,
  GRANTED_PAYMENT_TERM_MAX_INSTALLMENTS,
  GRANTED_PAYMENT_TERM_PARTIAL_COVERAGE_PERCENT,
  GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT,
  SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY,
  SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE,
  buildEmptySalesOrderGrantedPaymentTermSummary,
  computeGrantedPaymentTermSummary,
  describeGrantedPaymentTermReason,
  formatGrantedPaymentTermCoverage,
  formatGrantedPaymentTermDays,
  normalizeGrantedPaymentTermText,
  parseGrantedPaymentTerm,
  resolveGrantedPaymentTermCardPresentation,
  resolveGrantedPaymentTermQuality,
  type GrantedPaymentTermGroupInput,
  type SalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTerm.js";

function group(
  paymentTerms: string | null,
  salesAmount: number,
  orderCount = 1
): GrantedPaymentTermGroupInput {
  return { paymentTerms, orderCount, salesAmount };
}

function summaryWith(
  overrides: Partial<SalesOrderGrantedPaymentTermSummary>
): SalesOrderGrantedPaymentTermSummary {
  return { ...buildEmptySalesOrderGrantedPaymentTermSummary(), ...overrides };
}

describe("parseGrantedPaymentTerm — condições reconhecidas", () => {
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
      assert.ok(parsed.installmentDays.every((d) => Number.isFinite(d)));
      if (parsed.recognized) {
        assert.ok(parsed.installmentDays.length > 0);
      } else {
        assert.equal(parsed.averageDays, null);
      }
    }
    // Texto livre com números NÃO vira prazo.
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

describe("computeGrantedPaymentTermSummary — ponderação por valor líquido", () => {
  it("A R$ 10.000 @ 30 + B R$ 90.000 @ 60 → 57 dias (não 45)", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("30", 10_000), group("60", 90_000)],
      { totalOrders: 2 }
    );
    assert.equal(summary.weightedAverageDays, 57);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.available, true);
    assert.equal(summary.coveragePercent, 100);
    assert.equal(summary.orderCoveragePercent, 100);
    assert.equal(summary.recognizedSalesAmount, 100_000);
    assert.equal(summary.totalWeightedSalesAmount, 100_000);
    assert.equal(summary.recognizedOrders, 2);
    assert.equal(summary.weightedPopulationOrders, 2);
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.zeroOrNegativeOrders, 0);
    assert.deepEqual(summary.unrecognizedTerms, []);
  });

  it("R$ 10.000 @ 30/60 (45) + R$ 90.000 @ 30/60/90 (60) → 58,5 dias", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("30/60", 10_000), group("30/60/90", 90_000)],
      { totalOrders: 2 }
    );
    assert.equal(summary.weightedAverageDays, 58.5);
  });

  it("somente à vista → 0 dias, disponível e FULL", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("À vista", 5_000, 3), group("0 dias", 2_000)],
      { totalOrders: 4 }
    );
    assert.equal(summary.weightedAverageDays, 0);
    assert.equal(summary.available, true);
    assert.equal(summary.quality, "FULL");
    assert.equal(summary.recognizedOrders, 4);
  });

  it("mistura reconhecido/não reconhecido: R$ 80.000 reconhecido + R$ 20.000 desconhecido → 80% (PARTIAL)", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("30", 80_000, 8), group("boleto 30 dias", 20_000, 2)],
      { totalOrders: 10 }
    );
    assert.equal(summary.coveragePercent, 80);
    assert.equal(summary.orderCoveragePercent, 80);
    assert.equal(summary.quality, "PARTIAL");
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.recognizedSalesAmount, 80_000);
    assert.equal(summary.unrecognizedSalesAmount, 20_000);
    assert.equal(summary.unrecognizedOrders, 2);
    assert.equal(summary.unrecognizedTerms.length, 1);
    assert.equal(summary.unrecognizedTerms[0]!.paymentTerms, "boleto 30 dias");
    assert.equal(summary.unrecognizedTerms[0]!.salesAmount, 20_000);
    assert.equal(summary.unrecognizedTerms[0]!.orderCount, 2);
    assert.equal(summary.unrecognizedTerms[0]!.reason, "UNRECOGNIZED_FORMAT");
    assert.equal(summary.unrecognizedTerms[0]!.reasonLabel, "Formato não interpretável");
  });

  it("valor zero e negativo não participam do peso (sem abs, sem zero no denominador)", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("30", 10_000), group("60", 0), group("90", -5_000), group("120", Number.NaN)],
      { totalOrders: 4 }
    );
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.weightedPopulationOrders, 1);
    assert.equal(summary.zeroOrNegativeOrders, 3);
    assert.equal(summary.totalWeightedSalesAmount, 10_000);
    assert.equal(summary.coveragePercent, 100);
  });

  it("null / vazio / só espaços nunca viram prazo zero", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group(null, 1_000), group("", 1_000), group("   ", 1_000), group("30", 1_000)],
      { totalOrders: 4 }
    );
    assert.equal(summary.weightedAverageDays, 30);
    assert.equal(summary.coveragePercent, 25);
    assert.equal(summary.quality, "LOW");
    assert.equal(summary.unrecognizedTerms.length, 3);
    assert.ok(summary.unrecognizedTerms.every((t) => t.reason === "MISSING"));
  });

  it("ausência completa → UNAVAILABLE", () => {
    const empty = computeGrantedPaymentTermSummary([], { totalOrders: 0 });
    assert.equal(empty.quality, "UNAVAILABLE");
    assert.equal(empty.available, false);
    assert.equal(empty.weightedAverageDays, null);
    assert.equal(empty.coveragePercent, 0);
    assert.equal(empty.orderCoveragePercent, 0);

    const onlyUnrecognized = computeGrantedPaymentTermSummary(
      [group("boleto", 5_000, 2), group(null, 1_000)],
      { totalOrders: 3 }
    );
    assert.equal(onlyUnrecognized.quality, "UNAVAILABLE");
    assert.equal(onlyUnrecognized.available, false);
    assert.equal(onlyUnrecognized.weightedAverageDays, null);
    assert.equal(onlyUnrecognized.coveragePercent, 0);
    assert.equal(onlyUnrecognized.unrecognizedTerms.length, 2);
    assert.equal(onlyUnrecognized.unrecognizedTerms[0]!.paymentTerms, "boleto");

    const onlyZero = computeGrantedPaymentTermSummary([group("30", 0, 5)], { totalOrders: 5 });
    assert.equal(onlyZero.quality, "UNAVAILABLE");
    assert.equal(onlyZero.zeroOrNegativeOrders, 5);
  });

  it("auditoria: top N não reconhecidos por valor vendido desc", () => {
    const groups: GrantedPaymentTermGroupInput[] = [];
    for (let i = 0; i < GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT + 5; i += 1) {
      groups.push(group(`cond ${i}`, (i + 1) * 100, 1));
    }
    groups.push(group("30", 1_000));
    const summary = computeGrantedPaymentTermSummary(groups, { totalOrders: groups.length });
    assert.equal(summary.unrecognizedTerms.length, GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT);
    const amounts = summary.unrecognizedTerms.map((t) => t.salesAmount);
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    assert.equal(summary.unrecognizedTerms[0]!.salesAmount, 2_500);
    // Contadores consideram TODOS os não reconhecidos, não só o top N.
    assert.equal(summary.unrecognizedOrders, GRANTED_PAYMENT_TERM_UNRECOGNIZED_TOP_LIMIT + 5);

    const limited = computeGrantedPaymentTermSummary(groups, {
      totalOrders: groups.length,
      unrecognizedTopLimit: 3,
    });
    assert.equal(limited.unrecognizedTerms.length, 3);
  });

  it("DTO expõe fonte e metodologia estáveis", () => {
    const summary = computeGrantedPaymentTermSummary([group("30", 100)], { totalOrders: 1 });
    assert.equal(summary.source, "SalesOrder.paymentTerms");
    assert.equal(summary.source, SALES_ORDER_GRANTED_PAYMENT_TERM_SOURCE);
    assert.equal(summary.methodology, SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY);
    assert.match(summary.methodology, /ponderada pelo valor líquido/);
    assert.match(summary.methodology, /SalesOrder\.paymentTerms/);
    assert.match(summary.methodology, /média das parcelas/);
    assert.match(summary.methodology, /excluídas e refletidas na cobertura/);
  });

  it("precisão interna preservada (sem arredondar a matemática)", () => {
    const summary = computeGrantedPaymentTermSummary(
      [group("30", 1_234.56), group("45", 2_345.67), group("30/60/90", 3_456.78)],
      { totalOrders: 3 }
    );
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
    const at = (recognized: number, unknown: number) =>
      computeGrantedPaymentTermSummary(
        [group("30", recognized), group("boleto", unknown)],
        { totalOrders: 2 }
      );
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

  it("FULL mostra dias + cobertura do valor vendido (tone info)", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "FULL", weightedAverageDays: 47.84, coveragePercent: 98.2 })
    );
    assert.equal(p.quality, "FULL");
    assert.equal(p.value, "47,8 dias");
    assert.equal(p.valueSize, "default");
    assert.equal(p.subtitle, "Cobertura: 98,2% do valor vendido");
    assert.equal(p.tone, "info");
    assert.match(p.helperText, /30\/60 = 45 dias/);
    assert.match(p.helperText, /Não representa atraso ou prazo real de recebimento/);
    assert.doesNotMatch(p.helperText, /não reconhecidas/);
  });

  it("PARTIAL mostra dias + cobertura parcial (tone warning) e explica exclusão", () => {
    const p = resolveGrantedPaymentTermCardPresentation(
      summaryWith({ available: true, quality: "PARTIAL", weightedAverageDays: 47.84, coveragePercent: 89.4 })
    );
    assert.equal(p.value, "47,8 dias");
    assert.equal(p.subtitle, "Cobertura parcial: 89,4%");
    assert.equal(p.tone, "warning");
    assert.match(p.helperText, /não reconhecidas foram excluídas/);
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
    assert.equal(unavailable.subtitle, "Sem condições de pagamento suficientes");
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
