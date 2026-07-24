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

describe("calculateEstimatedCorporateIncomeTaxes", () => {
  it("CSLL 9% sobre base positiva", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 100_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedCsll, 9_000);
  });

  it("CSLL zero sobre base negativa", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: -50_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedCsll, 0);
    assert.equal(r.estimatedIrpjTotal, 0);
    assert.equal(r.estimatedIrpjCsllProvision, 0);
    assert.equal(r.estimatedNetIncomeAfterTaxes, -50_000);
  });

  it("IRPJ 15% abaixo do limite mensal", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 15_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjNormal, 2_250);
    assert.equal(r.estimatedIrpjAdditional, 0);
    assert.equal(r.estimatedIrpjTotal, 2_250);
  });

  it("IRPJ exatamente no limite mensal sem adicional", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 20_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjAdditionalThreshold, 20_000);
    assert.equal(r.estimatedIrpjAdditionalBase, 0);
    assert.equal(r.estimatedIrpjAdditional, 0);
    assert.equal(r.estimatedIrpjNormal, 3_000);
  });

  it("adicional de 10% apenas sobre o excedente", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 30_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjNormal, 4_500);
    assert.equal(r.estimatedIrpjAdditionalBase, 10_000);
    assert.equal(r.estimatedIrpjAdditional, 1_000);
    assert.equal(r.estimatedIrpjTotal, 5_500);
  });

  it("exemplo mensal base R$ 219.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 219_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedCsll, 19_710);
    assert.equal(r.estimatedIrpjNormal, 32_850);
    assert.equal(r.estimatedIrpjAdditional, 19_900);
    assert.equal(r.estimatedIrpjTotal, 52_750);
    assert.equal(r.estimatedIrpjCsllProvision, 72_460);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 146_540);
  });

  it("exemplo YTD julho base R$ 1.550.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 1_550_000,
      numberOfMonthsInPeriod: 7,
    });
    assert.equal(r.estimatedIrpjAdditionalThreshold, 140_000);
    assert.equal(r.estimatedCsll, 139_500);
    assert.equal(r.estimatedIrpjNormal, 232_500);
    assert.equal(r.estimatedIrpjAdditional, 141_000);
    assert.equal(r.estimatedIrpjTotal, 373_500);
    assert.equal(r.estimatedIrpjCsllProvision, 513_000);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 1_037_000);
  });

  it("janeiro usa limite de R$ 20.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 100_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjAdditionalThreshold, 20_000);
  });

  it("dezembro usa limite de R$ 240.000", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 100_000,
      numberOfMonthsInPeriod: 12,
    });
    assert.equal(r.estimatedIrpjAdditionalThreshold, 240_000);
    assert.equal(r.estimatedIrpjAdditional, 0);
  });

  it("base zero nao gera beneficio fiscal", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 0,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjCsllProvision, 0);
    assert.equal(r.estimatedNetIncomeAfterTaxes, 0);
  });

  it("CSLL nao reduz a base do IRPJ", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 100_000,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedIrpjNormal, roundDreMoney(100_000 * 0.15));
    assert.notEqual(r.estimatedIrpjNormal, roundDreMoney((100_000 - r.estimatedCsll) * 0.15));
  });

  it("usa valor monetario exato arredondado a centavos", () => {
    const r = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 219_000.004,
      numberOfMonthsInPeriod: 1,
    });
    assert.equal(r.estimatedTaxBase, 219_000);
    assert.equal(r.estimatedCsll, 19_710);
  });
});

describe("consolidacao por pessoa juridica", () => {
  it("lucro e prejuizo nao se compensam", () => {
    const a = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 100_000,
      numberOfMonthsInPeriod: 1,
    });
    const b = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: -40_000,
      numberOfMonthsInPeriod: 1,
    });
    const sum = sumEstimatedCorporateIncomeTaxes([a, b]);
    assert.equal(b.estimatedIrpjCsllProvision, 0);
    assert.equal(sum.estimatedIrpjCsllProvision, a.estimatedIrpjCsllProvision);
    assert.equal(sum.estimatedTaxBase, 60_000);
  });

  it("limite adicional aplicado por PJ (duas com lucro)", () => {
    const a = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 30_000,
      numberOfMonthsInPeriod: 1,
    });
    const b = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 30_000,
      numberOfMonthsInPeriod: 1,
    });
    const consolidatedWrong = calculateEstimatedCorporateIncomeTaxes({
      estimatedTaxBase: 60_000,
      numberOfMonthsInPeriod: 1,
    });
    const sum = sumEstimatedCorporateIncomeTaxes([a, b]);
    assert.equal(sum.estimatedIrpjAdditional, a.estimatedIrpjAdditional + b.estimatedIrpjAdditional);
    // Cada PJ usa seu próprio limite de R$ 20.000 — consolidar bases com um único limite superestima o adicional.
    assert.ok(sum.estimatedIrpjAdditional < consolidatedWrong.estimatedIrpjAdditional);
    assert.equal(sum.estimatedIrpjAdditionalThreshold, 40_000);
  });

  it("series multi-PJ somam provisoes mensais e YTD por entidade", () => {
    const entityA = emptyDreSeries();
    const entityB = emptyDreSeries();
    for (let i = 0; i < 7; i += 1) {
      entityA[i] = 100_000;
      entityB[i] = i === 6 ? -10_000 : 0;
    }
    const block = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [entityA, entityB],
      7,
      "per_legal_entity"
    );
    assert.equal(block.consolidationMode, "per_legal_entity");
    assert.equal(block.month.estimatedIrpjCsllProvision, block.csllByMonth[6]! + block.irpjByMonth[6]!);
    assert.equal(block.ytd.numberOfMonthsInPeriod, 7);
    assert.equal(block.provisionYtd, block.ytd.estimatedIrpjCsllProvision);
  });
});

describe("buildFinanceDreLines + provisoes estimadas", () => {
  function baseInput(overrides = {}) {
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
    const net = lines.find((l) => l.id === "lucro_liquido_aproximado");
    assert.ok(parent && csll && irpj && net);
    assert.equal(
      roundDreMoney(Math.abs(parent.values.highlight)),
      roundDreMoney(Math.abs(csll.values.highlight) + Math.abs(irpj.values.highlight))
    );
    assert.equal(parent.values.highlight, -estimatedCorporateTaxes.month.estimatedIrpjCsllProvision);
    assert.equal(kpis.resultadoOperacional, 400);
    assert.equal(kpis.lucroLiquidoAproximado, estimatedCorporateTaxes.month.estimatedNetIncomeAfterTaxes);
    assert.equal(
      net.values.highlight,
      roundDreMoney(400 - estimatedCorporateTaxes.month.estimatedIrpjCsllProvision)
    );
  });

  it("% RL e receita liquida zero", () => {
    const { lines } = buildFinanceDreLines(
      baseInput({
        receitaBruta: emptyDreSeries(),
        pis: emptyDreSeries(),
        cmv: emptyDreSeries(),
        fretes: emptyDreSeries(),
        embalagens: emptyDreSeries(),
        despesasAdmin: emptyDreSeries(),
      })
    );
    const net = lines.find((l) => l.id === "lucro_liquido_aproximado");
    assert.equal(net?.pctOfNetRevenue, null);
  });

  it("YTD usa mes selecionado no limite do adicional", () => {
    const receita = emptyDreSeries();
    for (let i = 0; i < 7; i += 1) receita[i] = 300_000;
    const { estimatedCorporateTaxes } = buildFinanceDreLines(
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
    assert.equal(estimatedCorporateTaxes.ytd.numberOfMonthsInPeriod, 7);
    assert.equal(estimatedCorporateTaxes.ytd.estimatedIrpjAdditionalThreshold, 140_000);
    assert.equal(estimatedCorporateTaxes.month.numberOfMonthsInPeriod, 1);
  });

  it("API block retorna detalhamento completo", () => {
    const { estimatedCorporateTaxes } = buildFinanceDreLines(baseInput());
    assert.ok("estimatedTaxBase" in estimatedCorporateTaxes.month);
    assert.ok("estimatedCsll" in estimatedCorporateTaxes.month);
    assert.ok("estimatedIrpjNormal" in estimatedCorporateTaxes.month);
    assert.ok("estimatedIrpjAdditional" in estimatedCorporateTaxes.month);
    assert.ok("estimatedIrpjTotal" in estimatedCorporateTaxes.month);
    assert.ok("estimatedIrpjCsllProvision" in estimatedCorporateTaxes.month);
    assert.ok("estimatedNetIncomeAfterTaxes" in estimatedCorporateTaxes.month);
    assert.equal(estimatedCorporateTaxes.includesFinancialResult, false);
    assert.equal(estimatedCorporateTaxes.baseSource, "resultado_operacional");
  });

  it("override multi-PJ nao usa um unico limite consolidado", () => {
    const a = emptyDreSeries();
    a[0] = 30_000;
    const b = emptyDreSeries();
    b[0] = 30_000;
    const override = buildEstimatedCorporateTaxSeriesFromEntityBases(
      [a, b],
      1,
      "per_legal_entity"
    );
    const consolidated = emptyDreSeries();
    consolidated[0] = 60_000;
    const single = buildEstimatedCorporateTaxSeriesFromSingleBase(consolidated, 1);
    assert.ok(override.month.estimatedIrpjAdditional < single.month.estimatedIrpjAdditional);
    assert.equal(override.month.estimatedIrpjAdditionalThreshold, 40_000);
    const { estimatedCorporateTaxes } = buildFinanceDreLines(
      baseInput({ estimatedCorporateTaxesOverride: override })
    );
    assert.equal(estimatedCorporateTaxes.consolidationMode, "per_legal_entity");
    assert.equal(
      estimatedCorporateTaxes.month.estimatedIrpjAdditional,
      override.month.estimatedIrpjAdditional
    );
  });
});
