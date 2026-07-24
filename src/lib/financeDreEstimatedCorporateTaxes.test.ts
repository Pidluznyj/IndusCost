import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEstimatedCorporateTaxSeriesFromEntityBases,
  buildEstimatedCorporateTaxSeriesFromSingleBase,
  calculateEstimatedCorporateIncomeTaxes,
  sumEstimatedCorporateIncomeTaxes,
} from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import {
  buildFinanceDreLines,
  emptyDreSeries,
  roundDreMoney,
} from "@/src/lib/financeDreMath.js";

function entity(
  key: string,
  label: string,
  cnpj: string,
  byMonth: number[]
) {
  return {
    companyKey: key,
    companyLabel: label,
    cnpjDigits: cnpj,
    baseByMonth: byMonth,
  };
}

describe("calculateEstimatedCorporateIncomeTaxes — estimativa mensal", () => {
  it("CSLL 9% sobre base positiva", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    assert.equal(r.estimatedCsll, 9_000);
  });

  it("base mensal negativa gera provisao zero", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: -50_000 });
    assert.equal(r.estimatedCsll, 0);
    assert.equal(r.estimatedIrpjTotal, 0);
    assert.equal(r.estimatedIrpjCsllProvision, 0);
    assert.equal(r.estimatedNetIncomeAfterTaxes, -50_000);
  });

  it("base mensal zero gera provisao zero", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 0 });
    assert.equal(r.estimatedIrpjCsllProvision, 0);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 0);
  });

  it("base de R$ 10.000 sem adicional", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 10_000 });
    assert.equal(r.estimatedCsll, 900);
    assert.equal(r.estimatedIrpjTotal, 1_500);
    assert.equal(r.estimatedIrpjAdditional, 0);
  });

  it("base de R$ 20.000 sem adicional", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 20_000 });
    assert.equal(r.estimatedCsll, 1_800);
    assert.equal(r.estimatedIrpjNormal, 3_000);
    assert.equal(r.estimatedIrpjAdditional, 0);
    assert.equal(r.estimatedIrpjAdditionalThreshold, 20_000);
  });

  it("base de R$ 20.001 gera adicional somente sobre R$ 1", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 20_001 });
    assert.equal(r.estimatedIrpjAdditionalBase, 1);
    assert.equal(r.estimatedIrpjAdditional, 0.1);
  });

  it("exemplo obrigatorio — base R$ 139.900 (uma PJ)", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 139_900 });
    assert.equal(r.estimatedCsll, 12_591);
    assert.equal(r.estimatedIrpjNormal, 20_985);
    assert.equal(r.estimatedIrpjAdditionalBase, 119_900);
    assert.equal(r.estimatedIrpjAdditional, 11_990);
    assert.equal(r.estimatedIrpjTotal, 32_975);
    assert.equal(r.estimatedIrpjCsllProvision, 45_566);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 94_334);
  });

  it("exemplo mensal base R$ 219.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 219_000 });
    assert.equal(r.estimatedCsll, 19_710);
    assert.equal(r.estimatedIrpjTotal, 52_750);
    assert.equal(r.estimatedIrpjCsllProvision, 72_460);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 146_540);
  });

  it("CSLL nao reduz a base do IRPJ", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    assert.equal(r.estimatedIrpjNormal, roundDreMoney(100_000 * 0.15));
    assert.notEqual(r.estimatedIrpjNormal, roundDreMoney((100_000 - r.estimatedCsll) * 0.15));
  });

  it("adicional nao incide sobre os primeiros R$ 20.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 30_000 });
    assert.equal(r.estimatedIrpjAdditionalBase, 10_000);
    assert.equal(r.estimatedIrpjAdditional, 1_000);
  });

  it("limite mensal e sempre R$ 20.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    assert.equal(r.estimatedIrpjAdditionalThreshold, 20_000);
    assert.equal(r.numberOfMonthsInPeriod, 1);
  });
});

describe("consolidacao por pessoa juridica", () => {
  it("lucro e prejuizo nao se compensam", () => {
    const a = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    const b = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: -40_000 });
    const sum = sumEstimatedCorporateIncomeTaxes([a, b]);
    assert.equal(b.estimatedIrpjCsllProvision, 0);
    assert.equal(sum.estimatedIrpjCsllProvision, a.estimatedIrpjCsllProvision);
    assert.equal(sum.estimatedTaxBase, 60_000);
  });

  it("exemplo obrigatorio multiempresa R$ 215.600 e R$ -75.700", () => {
    const a = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 215_600 });
    const b = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: -75_700 });
    const sum = sumEstimatedCorporateIncomeTaxes([a, b]);
    assert.equal(a.estimatedCsll, 19_404);
    assert.equal(a.estimatedIrpjNormal, 32_340);
    assert.equal(a.estimatedIrpjAdditional, 19_560);
    assert.equal(a.estimatedIrpjTotal, 51_900);
    assert.equal(a.estimatedIrpjCsllProvision, 71_304);
    assert.equal(b.estimatedIrpjCsllProvision, 0);
    assert.equal(sum.estimatedTaxBase, 139_900);
    assert.equal(sum.estimatedIrpjCsllProvision, 71_304);
    assert.equal(sum.estimatedNetIncomeAfterTaxes, 68_596);
  });

  it("diagnostico: provisao ~71,1 mil sobre consolidado 139,9 mil = CORRECT_MULTI_ENTITY", () => {
    const aSeries = emptyDreSeries();
    const bSeries = emptyDreSeries();
    aSeries[6] = 215_600;
    bSeries[6] = -75_700;
    const block = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [
        entity("a", "Empresa A", "72569510000195", aSeries),
        entity("b", "Empresa B", "14055501000180", bSeries),
      ],
      7,
      "per_legal_entity"
    );
    assert.equal(block.month.estimatedTaxBase, 139_900);
    assert.equal(block.month.estimatedIrpjCsllProvision, 71_304);
    assert.equal(block.entitiesHighlightMonth.length, 2);
    assert.ok(
      block.month.estimatedIrpjCsllProvision >
        calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 139_900 })
          .estimatedIrpjCsllProvision
    );
  });

  it("limite adicional aplicado por PJ (duas com lucro)", () => {
    const a = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 30_000 });
    const b = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 30_000 });
    const wrong = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 60_000 });
    const sum = sumEstimatedCorporateIncomeTaxes([a, b]);
    assert.ok(sum.estimatedIrpjAdditional < wrong.estimatedIrpjAdditional);
  });

  it("unidades do mesmo CNPJ sao consolidadas antes do calculo", () => {
    const u1 = emptyDreSeries();
    const u2 = emptyDreSeries();
    u1[0] = 25_000;
    u2[0] = 25_000;
    const block = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [
        entity("filial-a", "Filial A", "72569510000195", u1),
        entity("filial-b", "Filial B", "72569510000195", u2),
      ],
      1,
      "per_legal_entity"
    );
    const expected = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 50_000 });
    assert.equal(block.entitiesHighlightMonth.length, 1);
    assert.equal(block.month.estimatedTaxBase, 50_000);
    assert.equal(block.month.estimatedIrpjCsllProvision, expected.estimatedIrpjCsllProvision);
    assert.equal(block.month.estimatedIrpjAdditional, 3_000);
  });

  it("YTD positiveBase soma bases positivas por PJ (sem compensar prejuizo)", () => {
    const a = emptyDreSeries();
    const b = emptyDreSeries();
    a[0] = 100_000;
    b[0] = -40_000;
    const block = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [
        entity("a", "A", "72569510000195", a),
        entity("b", "B", "14055501000180", b),
      ],
      1,
      "per_legal_entity"
    );
    assert.equal(block.month.estimatedTaxBase, 60_000);
    assert.equal(block.month.positiveBase, 100_000);
    assert.equal(block.ytd.positiveBase, 100_000);
    assert.equal(block.ytd.estimatedIrpjAdditionalBase, 80_000);
  });
});

describe("YTD = soma das estimativas mensais", () => {
  it("YTD nao recalcula tributo sobre base acumulada", () => {
    const series = emptyDreSeries();
    for (let i = 0; i < 7; i += 1) series[i] = 100_000;
    const block = buildEstimatedCorporateTaxSeriesFromSingleBase(series, 7);
    const monthly = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    assert.equal(block.ytdMethod, "sum_of_monthly_estimates");
    assert.equal(block.ytd.aggregation, "sum_of_monthly_estimates");
    assert.equal(block.ytd.monthsSummed, 7);
    assert.equal(block.csllYtd, roundDreMoney(monthly.estimatedCsll * 7));
    assert.equal(block.provisionYtd, roundDreMoney(monthly.estimatedIrpjCsllProvision * 7));
    // Recalcular uma única vez sobre a base acumulada (errado nesta tela) diverge da soma mensal
    const wrongAccruedOnce = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 700_000,
    });
    assert.notEqual(block.provisionYtd, wrongAccruedOnce.estimatedIrpjCsllProvision);
  });

  it("mes negativo nao reduz provisao de mes positivo", () => {
    const series = emptyDreSeries();
    series[0] = 100_000;
    series[1] = -50_000;
    const block = buildEstimatedCorporateTaxSeriesFromSingleBase(series, 2);
    const jan = calculateEstimatedCorporateIncomeTaxes({ estimatedTaxBase: 100_000 });
    assert.equal(block.provisionByMonth[0], jan.estimatedIrpjCsllProvision);
    assert.equal(block.provisionByMonth[1], 0);
    assert.equal(block.provisionYtd, jan.estimatedIrpjCsllProvision);
  });

  it("limite de R$ 20.000 e reaplicado a cada mes", () => {
    const series = emptyDreSeries();
    series[0] = 30_000;
    series[1] = 30_000;
    const block = buildEstimatedCorporateTaxSeriesFromSingleBase(series, 2);
    assert.equal(block.irpjAdditionalByMonth[0], 1_000);
    assert.equal(block.irpjAdditionalByMonth[1], 1_000);
    assert.equal(block.ytd.estimatedIrpjAdditional, 2_000);
    assert.equal(block.ytd.estimatedIrpjAdditionalThreshold, 20_000);
  });
});

describe("buildFinanceDreLines + provisoes estimadas", () => {
  function baseInput(overrides: Record<string, unknown> = {}) {
    const receita = emptyDreSeries();
    receita[0] = 1_000;
    const pis = emptyDreSeries();
    pis[0] = 20;
    const cmv = emptyDreSeries();
    cmv[0] = 400;
    const fretes = emptyDreSeries();
    fretes[0] = 50;
    const embalagens = emptyDreSeries();
    embalagens[0] = 30;
    const admin = emptyDreSeries();
    admin[0] = 100;
    return {
      highlightMonth: 1,
      receitaBruta: receita,
      cofins: emptyDreSeries(),
      icms: emptyDreSeries(),
      icmsSt: emptyDreSeries(),
      ipi: emptyDreSeries(),
      pis,
      devolucoes: emptyDreSeries(),
      cmv,
      fretes,
      embalagens,
      despesasAdmin: admin,
      despesasPessoal: emptyDreSeries(),
      impostosCc: emptyDreSeries(),
      materiaPrimaCc: emptyDreSeries(),
      unclassifiedCcAmount: emptyDreSeries(),
      quality: { unlinkedNfeCount: 0, unlinkedNfeRevenue: 0, taxSummaryGapCount: 0 },
      ...overrides,
    };
  }

  it("nao altera receita, CMV, deducoes nem despesas operacionais", () => {
    const { lines } = buildFinanceDreLines(baseInput());
    assert.equal(lines.find((l) => l.id === "receita_liquida")?.values.highlight, 980);
    assert.equal(lines.find((l) => l.id === "cmv")?.values.highlight, -400);
    assert.equal(lines.find((l) => l.id === "pis")?.values.highlight, -20);
    assert.equal(lines.find((l) => l.id === "despesas_administrativas")?.values.highlight, -100);
    assert.equal(lines.find((l) => l.id === "resultado_operacional")?.values.highlight, 400);
  });

  it("linhas pai/filhas fecham e lucro apos provisoes", () => {
    const { lines, kpis, estimatedCorporateTaxes } = buildFinanceDreLines(baseInput());
    const parent = lines.find((l) => l.id === "provisoes_estimadas_irpj_csll");
    const csll = lines.find((l) => l.id === "csll_estimada");
    const irpj = lines.find((l) => l.id === "irpj_estimado");
    assert.ok(parent && csll && irpj);
    assert.equal(
      roundDreMoney(Math.abs(parent.values.highlight)),
      roundDreMoney(Math.abs(csll.values.highlight) + Math.abs(irpj.values.highlight))
    );
    assert.equal(kpis.lucroLiquidoAproximado, estimatedCorporateTaxes.month.estimatedNetIncomeAfterTaxes);
  });

  it("YTD da linha e soma mensal das provisoes", () => {
    const receita = emptyDreSeries();
    for (let i = 0; i < 7; i += 1) receita[i] = 300_000;
    const { lines, estimatedCorporateTaxes } = buildFinanceDreLines(
      baseInput({
        highlightMonth: 7,
        receitaBruta: receita,
        pis: emptyDreSeries(),
        cmv: emptyDreSeries(),
        fretes: emptyDreSeries(),
        embalagens: emptyDreSeries(),
        despesasAdmin: emptyDreSeries(),
      })
    );
    assert.equal(estimatedCorporateTaxes.ytdMethod, "sum_of_monthly_estimates");
    assert.equal(estimatedCorporateTaxes.ytd.monthsSummed, 7);
    assert.equal(estimatedCorporateTaxes.ytd.estimatedIrpjAdditionalThreshold, 20_000);
    const parent = lines.find((l) => l.id === "provisoes_estimadas_irpj_csll");
    assert.equal(parent?.values.ytd, -estimatedCorporateTaxes.provisionYtd);
  });

  it("override multi-PJ nao usa um unico limite consolidado", () => {
    const a = emptyDreSeries();
    a[0] = 30_000;
    const b = emptyDreSeries();
    b[0] = 30_000;
    const override = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [
        entity("a", "A", "72569510000195", a),
        entity("b", "B", "14055501000180", b),
      ],
      1,
      "per_legal_entity"
    );
    const single = buildEstimatedCorporateTaxSeriesFromSingleBase(
      (() => {
        const s = emptyDreSeries();
        s[0] = 60_000;
        return s;
      })(),
      1
    );
    assert.ok(override.month.estimatedIrpjAdditional < single.month.estimatedIrpjAdditional);
    const { estimatedCorporateTaxes } = buildFinanceDreLines(
      baseInput({ estimatedCorporateTaxesOverride: override })
    );
    assert.equal(estimatedCorporateTaxes.consolidationMode, "per_legal_entity");
    assert.equal(estimatedCorporateTaxes.entitiesHighlightMonth.length, 2);
  });

  it("% RL mensal e YTD usam receita liquida", () => {
    const { lines } = buildFinanceDreLines(baseInput());
    const parent = lines.find((l) => l.id === "provisoes_estimadas_irpj_csll");
    assert.ok(parent?.pctOfNetRevenue != null);
    const zero = buildFinanceDreLines(
      baseInput({
        receitaBruta: emptyDreSeries(),
        pis: emptyDreSeries(),
        cmv: emptyDreSeries(),
        fretes: emptyDreSeries(),
        embalagens: emptyDreSeries(),
        despesasAdmin: emptyDreSeries(),
      })
    );
    assert.equal(
      zero.lines.find((l) => l.id === "lucro_liquido_aproximado")?.pctOfNetRevenue,
      null
    );
  });
});
