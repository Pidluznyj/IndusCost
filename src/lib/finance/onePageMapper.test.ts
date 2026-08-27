import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOnePagePayload,
  computeVariationPercent,
  requireSummaryCard,
  type OnePageEngineInputs,
} from "./onePageMapper.js";
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
    now: NOW,
    ...overrides,
  };
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
