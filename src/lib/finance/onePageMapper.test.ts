import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOnePageDreSection,
  buildOnePagePayload,
  computeVariationPercent,
  requireSummaryCard,
  type OnePageEngineInputs,
} from "./onePageMapper.js";
import { extractFinanceDreOnePageSummaryValues } from "../financeDreOnePageSummary.js";
import {
  buildFinanceDreReportFromRawSources,
  type FinanceDreRawSourceSeries,
} from "../financeDreReportBuilder.js";
import { resolveOnePagePeriod } from "./onePagePeriod.js";
import { isIntercompanySalesOrder } from "../financeInternalGroupExclusions.js";
import type {
  BillingDashboardTab,
  SalesOrdersDashboardTab,
} from "../executiveDashboardTypes.js";

const NOW = new Date(2026, 7, 27, 9, 15, 0, 0); // 27/08/2026

function card(id: string, value: number | null) {
  return { id, label: id, value, formatted: String(value ?? "—") };
}

function billingTabFixture(
  overrides: Partial<Record<string, unknown>> = {}
): BillingDashboardTab {
  return {
    summaryCards: [
      card("billing-month", 1_200_000),
      card("billing-prev-month", 1_000_000),
      card("billing-year", 9_800_000),
    ],
    yearComparison: {
      yearToDateCurrent: 9_500_000,
      yearToDatePrevious: 8_000_000,
      previousYearTotal: 12_000_000,
      annualTarget: 14_400_000,
      formatted: {
        yearToDateCurrent: "",
        yearToDatePrevious: "",
        previousYearTotal: "",
        annualTarget: "",
      },
    },
    target: {
      actual: 1_200_000,
      previousPeriod: 1_000_000,
      target: 1_200_000,
      gap: 0,
      achievementPercent: 100,
    },
    accumulatedEvolution: [
      {
        month: 1,
        monthLabel: "Jan",
        previousYearAccumulated: 800_000,
        currentYearAccumulated: 900_000,
        accumulatedTarget: 960_000,
        projectedAccumulated: 950_000,
      },
      {
        month: 8,
        monthLabel: "Ago",
        previousYearAccumulated: 8_000_000,
        currentYearAccumulated: 9_500_000,
        accumulatedTarget: 9_600_000,
        projectedAccumulated: 9_700_000,
      },
    ],
    ...overrides,
  } as unknown as BillingDashboardTab;
}

function salesTabFixture(
  overrides: Partial<Record<string, unknown>> = {}
): SalesOrdersDashboardTab {
  return {
    summaryCards: [
      card("realized-month", 2_000_000),
      card("realized-ytd", 10_000_000),
      card("open-portfolio", 3_500_000),
      card("annual-target", 16_800_000),
    ],
    target: {
      actual: 2_000_000,
      previousPeriod: 1_600_000,
      target: 1_920_000,
      gap: null,
      achievementPercent: null,
    },
    previousYearComparableYtd: {
      net: 9_000_000,
      referenceDate: new Date(2025, 7, 27, 23, 59, 59, 999).toISOString(),
      formatted: "",
    },
    accumulatedEvolution: [
      {
        month: 8,
        monthLabel: "Ago",
        previousYearAccumulated: 9_000_000,
        currentYearAccumulated: 10_000_000,
        accumulatedTarget: 10_800_000,
        projectedAccumulated: 10_500_000,
      },
    ],
    ...overrides,
  } as unknown as SalesOrdersDashboardTab;
}

function buildInputs(overrides: Partial<OnePageEngineInputs> = {}): OnePageEngineInputs {
  return {
    period: resolveOnePagePeriod("2026", "8", NOW),
    billingTab: billingTabFixture(),
    salesTab: salesTabFixture(),
    margin: { percent: 27.4, orderCount: 12 },
    dre: null,
    now: NOW,
    ...overrides,
  };
}

/** Séries brutas simples para montar um FinanceDreReport canônico nos testes. */
function dreRawFixture(company: FinanceDreRawSourceSeries["company"]): FinanceDreRawSourceSeries {
  const series = (base: number) =>
    Array.from({ length: 12 }, (_, i) => Math.round(base * (i + 1) * 100) / 100);
  const zero = () => Array.from({ length: 12 }, () => 0);
  return {
    year: 2026,
    company,
    receitaBrutaByMonth: series(100_000),
    deductions: {
      cofins: series(2_000),
      icms: series(5_000),
      icmsSt: zero(),
      ipi: series(1_000),
      pis: series(500),
      devolucoes: series(1_500),
      taxSummaryGapCount: 0,
    },
    cmv: {
      cmvByMonth: series(40_000),
      missingItemsRevenueByMonth: zero(),
      missingProductRevenueByMonth: zero(),
      missingCostRevenueByMonth: zero(),
      missingItemsNfeCount: 0,
      missingProductLineCount: 0,
      missingCostLineCount: 0,
      pricedLineCount: 10,
    },
    costCenters: {
      byCostCenter: [
        {
          costCenterId: `cc-log-${company}`,
          code: "CC10",
          name: "Logistica",
          byMonth: series(3_000),
        },
        {
          costCenterId: `cc-emb-${company}`,
          code: "CC11",
          name: "Embalagens",
          byMonth: series(1_000),
        },
        {
          costCenterId: `cc-adm-${company}`,
          code: "CC20",
          name: "Administrativo",
          byMonth: series(8_000),
        },
      ],
      unclassifiedByMonth: zero(),
    },
  };
}

function dreReportFixture() {
  return buildFinanceDreReportFromRawSources({
    filters: { year: 2026, highlightMonth: 8, company: "all", dateBase: "emissao" },
    availableThroughMonth: 8,
    roleMap: null,
    consolidated: dreRawFixture("all"),
    perEntity: [dreRawFixture("lazarios"), dreRawFixture("koppetel"), dreRawFixture("sm")],
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
}

describe("One Page — paridade Faturamento com o motor oficial (NF-e)", () => {
  it("A — faturamento do mês = card billing-month do motor", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.liquido, 1_200_000);
  });

  it("B — YTD = yearComparison.yearToDateCurrent oficial", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.ytd, 9_500_000);
  });

  it("C — YTD anterior = yearComparison.yearToDatePrevious oficial", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.ytdPrevious, 8_000_000);
  });

  it("D — diferença YTD = current - previous", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.ytdDiff, 1_500_000);
  });

  it("E — variação YTD = ((cur - prev)/prev)*100; denominador zero sem Infinity/NaN", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.ytdVariation, 18.75);

    const zeroBase = buildOnePagePayload(
      buildInputs({
        billingTab: billingTabFixture({
          yearComparison: {
            yearToDateCurrent: 9_500_000,
            yearToDatePrevious: 0,
            previousYearTotal: 0,
            annualTarget: null,
            formatted: {
              yearToDateCurrent: "",
              yearToDatePrevious: "",
              previousYearTotal: "",
              annualTarget: "",
            },
          },
        }),
      })
    );
    assert.equal(zeroBase.faturamento.ytdVariation, null);
    assert.equal(zeroBase.faturamento.ytdVariationFormatted, "Sem base comparativa");
    assert.equal(zeroBase.faturamento.atingimento, null);
    assert.equal(zeroBase.faturamento.atingimentoFormatted, "—");
  });

  it("meta = yearComparison.annualTarget; atingimento = YTD / meta anual", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.meta, 14_400_000);
    assert.ok(Math.abs((payload.faturamento.atingimento ?? 0) - (9_500_000 / 14_400_000) * 100) < 1e-9);
  });

  it("YoY do mês usa mesmo mês do ano ANTERIOR — valor e rótulo", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.liquidoGrowthPercent, 20);
    assert.match(payload.faturamento.liquidoGrowthPercentFormatted, /Agosto\/2025/);
    assert.doesNotMatch(payload.faturamento.liquidoGrowthPercentFormatted, /Julho\/2026/);
  });

  it("gráfico acumulado espelha accumulatedEvolution do motor", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.faturamento.chartData.length, 12);
    const aug = payload.faturamento.chartData.find((p) => p.month === 8)!;
    assert.equal(aug.currentYear, 9_500_000);
    assert.equal(aug.previousYear, 8_000_000);
    assert.equal(aug.target, 9_600_000);
  });
});

describe("One Page — paridade Pedidos de Venda com o motor oficial", () => {
  it("mês/YTD/backlog vêm dos cards canônicos", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.pedidoVenda.total, 2_000_000);
    assert.equal(payload.pedidoVenda.ytd, 10_000_000);
    assert.equal(payload.pedidoVenda.backlog, 3_500_000);
  });

  it("H — YoY mensal usa target.previousPeriod (Agosto/2025) e o rótulo identifica Agosto/2025", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.pedidoVenda.totalGrowthPercent, 25);
    assert.match(payload.pedidoVenda.totalGrowthPercentFormatted, /Agosto\/2025/);
    assert.doesNotMatch(payload.pedidoVenda.totalGrowthPercentFormatted, /Julho\/2026/);
  });

  it("I — YTD anterior vem do comparável simétrico exposto pelo motor", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.pedidoVenda.ytdPrevious, 9_000_000);
    assert.equal(payload.pedidoVenda.ytdDiff, 1_000_000);
    assert.ok(Math.abs((payload.pedidoVenda.ytdVariation ?? 0) - (1_000_000 / 9_000_000) * 100) < 1e-9);
  });

  it("motor sem previousYearComparableYtd → falha clara (contrato quebrado)", () => {
    assert.throws(
      () =>
        buildOnePagePayload(
          buildInputs({ salesTab: salesTabFixture({ previousYearComparableYtd: undefined }) })
        ),
      /previousYearComparableYtd/
    );
  });
});

describe("One Page — IDs obrigatórios nunca degradam para zero", () => {
  it("card obrigatório ausente lança erro nomeando o ID", () => {
    assert.throws(
      () => requireSummaryCard([card("billing_net_found", 999)], "billing-month", "NF-e"),
      /billing-month/
    );
  });

  it("motor com IDs errados (ex.: billing_net_found) → mapper LANÇA, não devolve R$ 0", () => {
    const broken = billingTabFixture({
      summaryCards: [card("billing_net_found", 1_200_000)],
    });
    assert.throws(() => buildOnePagePayload(buildInputs({ billingTab: broken })), /billing-month/);
  });

  it("motor de pedidos sem realized-ytd → lança", () => {
    const broken = salesTabFixture({
      summaryCards: [card("realized-month", 1), card("open-portfolio", 2)],
    });
    assert.throws(() => buildOnePagePayload(buildInputs({ salesTab: broken })), /realized-ytd/);
  });
});

describe("One Page — leitura executiva e margem", () => {
  it("não afirma R$ 0 quando há faturamento; margem informa escopo do período", () => {
    const payload = buildOnePagePayload(buildInputs());
    assert.equal(payload.leituraExecutiva.length, 3);
    assert.doesNotMatch(payload.leituraExecutiva[0]!, /R\$ 0,00/);
    assert.match(payload.leituraExecutiva[0]!, /9,50/);
    assert.match(payload.leituraExecutiva[2]!, /27,4%/);
    assert.match(payload.leituraExecutiva[2]!, /Ago\/2026/);
  });

  it("margem indisponível → frase de indisponibilidade, sem inventar número", () => {
    const payload = buildOnePagePayload(
      buildInputs({ margin: { percent: null, orderCount: 0 } })
    );
    assert.equal(payload.pedidoVenda.margem, null);
    assert.equal(payload.pedidoVenda.margemFormatted, "—");
    assert.match(payload.leituraExecutiva[2]!, /indisponível/);
  });

  it("computeVariationPercent protege denominador nulo/zero/negativo", () => {
    assert.equal(computeVariationPercent(100, 0), null);
    assert.equal(computeVariationPercent(100, null), null);
    assert.equal(computeVariationPercent(null, 50), null);
    assert.equal(computeVariationPercent(120, 100), 20);
  });
});

describe("One Page — resumo da DRE (fonte canônica, sem fórmula própria)", () => {
  it("extração usa as LINHAS canônicas por id — mês e YTD idênticos aos da DRE", () => {
    const report = dreReportFixture();
    const line = (id: string) => report.lines.find((l) => l.id === id)!;

    const month = extractFinanceDreOnePageSummaryValues(report, "month")!;
    assert.equal(month.receitaBruta, line("receita_bruta").values.highlight);
    assert.equal(month.receitaLiquida, line("receita_liquida").values.highlight);
    assert.equal(month.deducoes, line("deducoes").values.highlight);
    assert.equal(
      month.despesasOperacionais,
      line("despesas_operacionais").values.highlight
    );
    assert.equal(month.custos, line("custos").values.highlight);
    assert.equal(month.cmv, line("cmv").values.highlight);
    assert.equal(month.fretes, line("fretes").values.highlight);
    assert.equal(month.embalagens, line("embalagens").values.highlight);
    assert.equal(month.lucroBruto, line("lucro_bruto").values.highlight);
    assert.equal(
      month.resultadoOperacional,
      line("resultado_operacional").values.highlight
    );
    assert.equal(month.margemBrutaPct, report.kpis.margemBrutaPct);
    assert.equal(month.margemOperacionalPct, report.kpis.margemOperacionalPct);

    const ytd = extractFinanceDreOnePageSummaryValues(report, "ytd")!;
    assert.equal(ytd.receitaBruta, line("receita_bruta").values.ytd);
    assert.equal(ytd.receitaLiquida, line("receita_liquida").values.ytd);
    assert.equal(ytd.despesasOperacionais, line("despesas_operacionais").values.ytd);
    assert.equal(ytd.custos, line("custos").values.ytd);
    assert.equal(ytd.margemBrutaPct, report.kpis.ytd.margemBrutaPct);
    assert.equal(ytd.margemOperacionalPct, report.kpis.ytd.margemOperacionalPct);
    // Sinais canônicos preservados (deduções/custos/despesas negativos nas linhas).
    assert.ok(ytd.deducoes < 0);
    assert.ok(ytd.custos < 0);
    assert.ok(ytd.despesasOperacionais < 0);
    // Consistência interna canônica: custos = cmv + fretes + embalagens.
    assert.equal(
      Math.round((ytd.cmv + ytd.fretes + ytd.embalagens) * 100) / 100,
      ytd.custos
    );
    // A cascata narrativa fecha com os sinais canônicos:
    // Receita Bruta + Deduções = Receita Líquida; Líquida + Custos = Lucro
    // Bruto; Lucro Bruto + Despesas = Resultado Operacional.
    const round2 = (v: number) => Math.round(v * 100) / 100;
    assert.equal(round2(ytd.receitaBruta + ytd.deducoes), round2(ytd.receitaLiquida));
    assert.equal(round2(ytd.receitaLiquida + ytd.custos), round2(ytd.lucroBruto));
    assert.equal(
      round2(ytd.lucroBruto + ytd.despesasOperacionais),
      round2(ytd.resultadoOperacional)
    );
  });

  it("quality mapeada dos qualityAlerts canônicos (íntegro × ressalva)", () => {
    const clean = extractFinanceDreOnePageSummaryValues(dreReportFixture(), "ytd")!;
    assert.equal(clean.quality.alertCount, 0);
    const cleanSection = buildOnePageDreSection(
      { available: true, freshness: "fresh", computedAt: null, values: clean },
      "Agosto/2026"
    );
    assert.equal(cleanSection.quality.status, "ok");
    assert.equal(cleanSection.quality.label, "Dados íntegros");

    const withGaps = buildFinanceDreReportFromRawSources({
      filters: { year: 2026, highlightMonth: 8, company: "lazarios", dateBase: "emissao" },
      availableThroughMonth: 8,
      roleMap: null,
      consolidated: {
        ...dreRawFixture("lazarios"),
        cmv: { ...dreRawFixture("lazarios").cmv, missingCostLineCount: 3 },
      },
      perEntity: null,
      generatedAt: "2026-08-27T12:00:00.000Z",
    });
    const warn = extractFinanceDreOnePageSummaryValues(withGaps, "ytd")!;
    assert.ok(warn.quality.alertCount > 0);
    const warnSection = buildOnePageDreSection(
      { available: true, freshness: "stale", computedAt: "2026-08-27T10:00:00.000Z", values: warn },
      "Agosto/2026"
    );
    assert.equal(warnSection.quality.status, "warning");
    assert.match(warnSection.quality.label, /ressalva/);
    assert.equal(warnSection.freshness, "stale");
  });

  it("bloco formatado: deduções/custos em valor absoluto, timestamp HH:mm, payload numérico assinado", () => {
    const values = extractFinanceDreOnePageSummaryValues(dreReportFixture(), "ytd")!;
    const section = buildOnePageDreSection(
      {
        available: true,
        freshness: "fresh",
        computedAt: "2026-08-27T14:35:00.000Z",
        values,
      },
      "Janeiro – Agosto/2026 (YTD)"
    );
    assert.equal(section.available, true);
    assert.equal(section.receitaBruta, values.receitaBruta);
    assert.equal(section.deducoes, values.deducoes); // assinado no payload
    assert.equal(section.despesasOperacionais, values.despesasOperacionais);
    assert.ok(values.deducoes < 0);
    assert.ok(values.despesasOperacionais < 0);
    assert.equal(section.deducoesFormatted.includes("-"), false); // absoluto na exibição
    assert.equal(section.despesasOperacionaisFormatted.includes("-"), false);
    assert.equal(section.receitaBrutaFormatted.includes("—"), false);
    assert.equal(section.periodLabel, "Janeiro – Agosto/2026 (YTD)");
    assert.match(section.updatedAtLabel ?? "", /^\d{2}:\d{2}$/);
    assert.equal(section.margemBrutaPctFormatted.endsWith("%"), true);
  });

  it("indisponível: bloco seguro, restante do payload intacto", () => {
    const payload = buildOnePagePayload(buildInputs({ dre: null }));
    assert.equal(payload.dre.available, false);
    assert.equal(payload.dre.freshness, null);
    assert.match(payload.dre.quality.label, /preparação/);
    assert.equal(payload.dre.receitaLiquidaFormatted, "—");
    assert.equal(payload.dre.receitaBrutaFormatted, "—");
    assert.equal(payload.dre.despesasOperacionaisFormatted, "—");
    // O restante do One Page continua íntegro.
    assert.equal(payload.faturamento.ytd, 9_500_000);
    assert.equal(payload.pedidoVenda.total, 2_000_000);
  });

  it("payload completo carrega o bloco dre montado a partir do resumo", () => {
    const values = extractFinanceDreOnePageSummaryValues(dreReportFixture(), "ytd")!;
    const payload = buildOnePagePayload(
      buildInputs({
        dre: { available: true, freshness: "fresh", computedAt: null, values },
      })
    );
    assert.equal(payload.dre.available, true);
    assert.equal(payload.dre.receitaLiquida, values.receitaLiquida);
    assert.equal(payload.dre.resultadoOperacional, values.resultadoOperacional);
  });
});

describe("One Page — exclusão intercompany (regra oficial)", () => {
  it("cliente do grupo econômico é excluído; cliente externo permanece", () => {
    assert.equal(
      isIntercompanySalesOrder({
        Customer: {
          companyName: "Lazarios Comercio de Plasticos LTDA",
          tradeName: null,
          taxId: null,
        },
      }),
      true
    );
    assert.equal(
      isIntercompanySalesOrder({
        Customer: { companyName: "Cliente Externo SA", tradeName: null, taxId: "11222333000144" },
      }),
      false
    );
  });
});
