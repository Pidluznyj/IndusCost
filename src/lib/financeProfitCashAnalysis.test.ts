import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FINANCE_DRE_CASH_BRIDGE_COVERAGE } from "@/src/lib/financeDreCashBridgeCoverage.js";
import type { CashBridgeReport } from "@/src/lib/financeDreCashBridgeTypes.js";
import type { FinanceDreReport } from "@/src/lib/financeDreTypes.js";
import { FINANCE_DRE_OFFICIAL_SOURCES } from "@/src/lib/financeDreTypes.js";
import { buildEstimatedCorporateTaxSeriesFromSingleBase } from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import type { FinanceCashFlowDashboardPayload } from "@/src/lib/financeCashFlowDashboardTypes.js";
import {
  assembleProfitCashAnalysis,
  computeGapToExplain,
  resolveCashVariationFromCashFlow,
} from "@/src/lib/financeProfitCashAnalysisCore.js";
import {
  buildProfitCashHeadlineSubtitle,
} from "@/src/lib/financeProfitCashAnalysisNarrative.js";
import { canViewProfitCashAnalysis } from "@/src/lib/financeProfitCashAnalysisPermissions.js";
import type { ProfitCashAnalysisFilters } from "@/src/lib/financeProfitCashAnalysisTypes.js";

function emptySeries(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function makeDre(lucro: number, receitaLiquida = 1_000_000): FinanceDreReport {
  const series = emptySeries();
  series[2] = lucro;
  return {
    schemaVersion: 1,
    title: "DRE",
    subtitle: "t",
    disclaimer: "d",
    generatedAt: "2026-03-15T12:00:00.000Z",
    filters: { year: 2026, highlightMonth: 3, company: "all", dateBase: "emissao" },
    companyLabel: "Todas",
    monthLabels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
    kpis: {
      receitaBruta: receitaLiquida * 1.1,
      receitaBrutaPct: null,
      receitaLiquida,
      receitaLiquidaPct: 100,
      lucroBruto: receitaLiquida * 0.4,
      margemBrutaPct: 40,
      resultadoOperacional: lucro,
      margemOperacionalPct: (lucro / receitaLiquida) * 100,
      lucroLiquidoAproximado: lucro,
      margemLiquidaAproximadaPct: (lucro / receitaLiquida) * 100,
      ytd: {
        receitaBruta: receitaLiquida * 1.1,
        receitaBrutaPct: null,
        receitaLiquida,
        receitaLiquidaPct: 100,
        lucroBruto: receitaLiquida * 0.4,
        margemBrutaPct: 40,
        resultadoOperacional: lucro,
        margemOperacionalPct: (lucro / receitaLiquida) * 100,
        lucroLiquidoAproximado: lucro,
        margemLiquidaAproximadaPct: (lucro / receitaLiquida) * 100,
      },
    },
    estimatedCorporateTaxes: buildEstimatedCorporateTaxSeriesFromSingleBase(series, 3),
    lines: [],
    costCenterBreakdown: [],
    sourceChecks: [],
    informativeReport: {
      title: "Relatório informativo",
      subtitle: "",
      items: [],
      totalNotAppliedHighlight: 0,
      totalNotAppliedYtd: 0,
    },
    qualityAlerts: [],
    sources: FINANCE_DRE_OFFICIAL_SOURCES,
  };
}

function makeBridge(partial: {
  dreNetResult: number;
  badge?: CashBridgeReport["badge"];
  isReconciled?: boolean;
  canReconcile?: boolean;
  residual?: number | null;
  actualCashVariation?: number | null;
  investCashEffect?: number | null;
}): CashBridgeReport {
  const lines = [
    {
      id: "dre_net_result" as const,
      label: "Resultado líquido",
      cashEffect: partial.dreNetResult,
      includeInExplained: true,
      openingBalance: null,
      closingBalance: null,
      classification: "available" as const,
      missingReason: null,
      criteria: "",
      sources: ["DRE"],
      limitations: [],
      lastSyncedAt: null,
    },
    {
      id: "investments_paid" as const,
      label: "Investimentos pagos",
      cashEffect: partial.investCashEffect ?? null,
      includeInExplained: true,
      openingBalance: null,
      closingBalance: null,
      classification:
        partial.investCashEffect != null ? ("available" as const) : ("unavailable" as const),
      missingReason: partial.investCashEffect == null ? "parcial" : null,
      criteria: "",
      sources: ["AP"],
      limitations: [],
      lastSyncedAt: null,
    },
  ];
  return {
    schemaVersion: 1,
    title: "Ponte",
    subtitle: "",
    generatedAt: "2026-03-15T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    filters: { year: 2026, highlightMonth: 3, company: "all", dateBase: "emissao" },
    companyLabel: "Todas",
    periodLabel: "Mar/2026",
    dreNetResult: partial.dreNetResult,
    receitaLiquida: 1_000_000,
    materialityThreshold: 1000,
    canReconcile: partial.canReconcile ?? false,
    isReconciled: partial.isReconciled ?? false,
    badge: partial.badge ?? "partial_data",
    explainedCashVariation: partial.dreNetResult,
    actualCashVariation: partial.actualCashVariation ?? null,
    residual: partial.residual ?? null,
    cards: {
      netResult: partial.dreNetResult,
      workingCapitalEffect: null,
      investmentsPaid: partial.investCashEffect ?? null,
      actualCashVariation: partial.actualCashVariation ?? null,
    },
    lines,
    coverage: [...FINANCE_DRE_CASH_BRIDGE_COVERAGE],
    explanation: "parcial",
    warnings: [],
    periodCashMovementsReference: {
      includedInExplained: false,
      classification: "unavailable",
      receivablesCollected: null,
      payablesPaid: null,
      netMovements: null,
      note: "Movimentos do período não entram na fórmula patrimonial.",
      missingReason: "indisponível",
      hasInitialBankBalance: false,
      sources: [],
    },
    implementationStatus: "partial",
  };
}

function makeCashFlow(monthNet: number): FinanceCashFlowDashboardPayload {
  return {
    cards: {
      inflowAmount: Math.max(monthNet, 0) + 50_000,
      outflowAmount: Math.max(-monthNet, 0) + 50_000,
      netFlowAmount: monthNet,
    },
    executiveSummary: {
      monthlyTimeline: [
        {
          year: 2026,
          month: 3,
          monthLabel: "Mar",
          received: 80_000,
          receivableOpenDue: 20_000,
          estimatedInflow: 100_000,
          paid: 40_000,
          payableOpenDue: 20_000,
          estimatedOutflow: 100_000 - monthNet,
          netFlow: monthNet,
          accumulatedNet: monthNet,
        },
      ],
    },
    cashForecast: {
      horizons: {
        next12Months: {
          worstMonth: {
            month: 6,
            projectedNet: -25_000,
          },
        },
      },
    },
  } as unknown as FinanceCashFlowDashboardPayload;
}

const filters: ProfitCashAnalysisFilters = {
  year: 2026,
  highlightMonth: 3,
  company: "all",
  cashView: "period_movement_from_zero",
  projectionMode: "combined",
  comparePreviousYear: false,
};

describe("financeProfitCashAnalysis narrative", () => {
  it("4 combinações lucro± / caixa± sem causalidade indevida", () => {
    const a = buildProfitCashHeadlineSubtitle({ dreNetResult: 10, cashVariation: -5 });
    assert.equal(a.headline, "Lucro sim. Caixa não?");
    assert.match(a.subtitle, /resultado positivo/i);
    assert.doesNotMatch(a.subtitle, /porque|causou|devido a/i);

    const b = buildProfitCashHeadlineSubtitle({ dreNetResult: 10, cashVariation: 5 });
    assert.equal(b.headline, "Lucro sim. Caixa também.");

    const c = buildProfitCashHeadlineSubtitle({ dreNetResult: -10, cashVariation: 5 });
    assert.equal(c.headline, "Caixa sim. Lucro não?");
    assert.match(c.subtitle, /sem afirmar causalidade/i);

    const d = buildProfitCashHeadlineSubtitle({ dreNetResult: -10, cashVariation: -5 });
    assert.equal(d.headline, "Lucro não. Caixa também não.");

    const e = buildProfitCashHeadlineSubtitle({ dreNetResult: 10, cashVariation: null });
    assert.equal(e.headline, "Lucro sim. Caixa?");
  });
});

describe("financeProfitCashAnalysis gap e variação", () => {
  it("gapToExplain = lucro − variação do caixa", () => {
    assert.equal(computeGapToExplain(100_000, 40_000), 60_000);
    assert.equal(computeGapToExplain(100_000, -20_000), 120_000);
    assert.equal(computeGapToExplain(50_000, null), null);
  });

  it("cashView from zero usa netFlow da timeline (≠ saldo bancário)", () => {
    const cf = makeCashFlow(-30_000);
    const cash = resolveCashVariationFromCashFlow(cf, 3);
    assert.equal(cash.variation, -30_000);
    assert.equal(cash.inflow, 100_000);
  });
});

describe("financeProfitCashAnalysis assemble", () => {
  it("paridade numérica com DRE + CF + gap", () => {
    const dre = makeDre(120_000);
    const bridge = makeBridge({ dreNetResult: 120_000, investCashEffect: -15_000 });
    const cashFlow = makeCashFlow(-40_000);
    const payload = assembleProfitCashAnalysis({
      filters,
      dre,
      bridge,
      cashFlow,
      agingBuckets: [{ key: "overdue", label: "Vencido", amount: 8_000, count: 2 }],
      overdueReceivableAmount: 8_000,
      storyMode: "real_averages",
      generatedAt: "2026-03-15T12:00:00.000Z",
    });

    assert.equal(payload.summary.dreNetResult, 120_000);
    assert.equal(payload.summary.cashVariation, -40_000);
    assert.equal(payload.summary.gapToExplain, 160_000);
    assert.equal(payload.headline, "Lucro sim. Caixa não?");
    assert.match(payload.summary.cashViewLabel, /não é saldo bancário/i);
    assert.equal(payload.cycle.complete, false);
    assert.match(payload.cycle.message, /estoque|prazos/i);
    assert.ok(payload.factors.length >= 1);
    assert.ok(payload.factors.length <= 4);
    assert.equal(payload.moneyStory.steps.length, 5);
    assert.equal(payload.moneyStory.steps.find((s) => s.id === "collection")?.amount, null);
  });

  it("ponte reconciliada vs residual / parcial", () => {
    const dre = makeDre(50_000);
    const reconciled = assembleProfitCashAnalysis({
      filters,
      dre,
      bridge: makeBridge({
        dreNetResult: 50_000,
        badge: "reconciled",
        isReconciled: true,
        canReconcile: true,
        residual: 0,
        actualCashVariation: 50_000,
      }),
      cashFlow: makeCashFlow(50_000),
      agingBuckets: [],
      overdueReceivableAmount: null,
      storyMode: "real_averages",
    });
    assert.equal(reconciled.bridge.isReconciled, true);
    assert.equal(reconciled.qualityStatus, "complete");

    const divergent = assembleProfitCashAnalysis({
      filters,
      dre,
      bridge: makeBridge({
        dreNetResult: 50_000,
        badge: "not_reconciled",
        isReconciled: false,
        canReconcile: true,
        residual: 12_000,
        actualCashVariation: 38_000,
      }),
      cashFlow: makeCashFlow(38_000),
      agingBuckets: [],
      overdueReceivableAmount: null,
      storyMode: "real_averages",
    });
    assert.equal(divergent.qualityStatus, "divergent");
    assert.equal(divergent.bridge.residual, 12_000);

    const partial = assembleProfitCashAnalysis({
      filters,
      dre,
      bridge: makeBridge({ dreNetResult: 50_000, badge: "partial_data" }),
      cashFlow: makeCashFlow(10_000),
      agingBuckets: [],
      overdueReceivableAmount: null,
      storyMode: "real_averages",
    });
    assert.equal(partial.qualityStatus, "partial");
  });

  it("modo R$ 100 mil escala percentuais reais", () => {
    const dre = makeDre(200_000, 1_000_000);
    const payload = assembleProfitCashAnalysis({
      filters,
      dre,
      bridge: makeBridge({ dreNetResult: 200_000 }),
      cashFlow: null,
      agingBuckets: [],
      overdueReceivableAmount: null,
      storyMode: "normalized_100k",
    });
    assert.match(payload.moneyStory.didacticNotice ?? "", /100\.000|100,000|R\$ 100/);
    const billing = payload.moneyStory.steps.find((s) => s.id === "billing");
    assert.equal(billing?.amount, 100_000);
    const result = payload.moneyStory.steps.find((s) => s.id === "dre_result");
    assert.equal(result?.amount, 20_000);
  });

  it("sem fluxo → gap null e qualidade incompleta", () => {
    const payload = assembleProfitCashAnalysis({
      filters,
      dre: makeDre(10_000),
      bridge: makeBridge({ dreNetResult: 10_000 }),
      cashFlow: null,
      agingBuckets: [],
      overdueReceivableAmount: null,
      storyMode: "real_averages",
    });
    assert.equal(payload.summary.gapToExplain, null);
    assert.equal(payload.qualityStatus, "incomplete");
  });
});

describe("financeProfitCashAnalysis permissions", () => {
  it("aceita bags DRE/CF/finance e nega desconhecido", () => {
    assert.equal(canViewProfitCashAnalysis({ hasPermission: (k) => k === "finance.profit_cash.view" }), true);
    assert.equal(canViewProfitCashAnalysis({ hasPermission: (k) => k === "finance.dre.view" }), true);
    assert.equal(canViewProfitCashAnalysis({ hasPermission: (k) => k === "finance.cashFlow.view" }), true);
    assert.equal(canViewProfitCashAnalysis({ hasPermission: (k) => k === "finance.view" }), true);
    assert.equal(canViewProfitCashAnalysis({ hasPermission: () => false }), false);
  });
});
