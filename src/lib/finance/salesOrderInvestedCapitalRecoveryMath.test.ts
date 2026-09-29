import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCapitalRecovered,
  computeCapitalReceivableCovered,
  computeCapitalWithoutOpenReceivable,
  computeEconomicMargin,
  computeGainReceivable,
  computeInvestedCapitalRecoveryStatus,
  computeMoneyOnStreet,
  computeRealizedGain,
  computeRecoveryPercent,
  distributeMoneyOnStreetAcrossAging,
  isValidInvestedCapital,
  resolveCapitalRecoveryDate,
  resolveForecastCapitalRecoveryDate,
  resolveInvestedCapitalComponents,
  resolveInvestedCapitalRecoveryForecastSource,
} from "./salesOrderInvestedCapitalRecoveryMath.js";

/** Decomposição completa de um PV pela matemática pura (o que o snapshot faz). */
function decompose(input: { sale: number; capital: number | null; received: number; outstanding: number }) {
  const moneyOnStreet = computeMoneyOnStreet(input.capital, input.received);
  return {
    economicMargin: computeEconomicMargin(input.sale, input.capital),
    capitalRecovered: computeCapitalRecovered(input.capital, input.received),
    realizedGain: computeRealizedGain(input.capital, input.received),
    moneyOnStreet,
    capitalReceivableCovered: computeCapitalReceivableCovered(input.capital, moneyOnStreet, input.outstanding),
    gainReceivable: computeGainReceivable(input.capital, moneyOnStreet, input.outstanding),
    capitalWithoutOpenReceivable: computeCapitalWithoutOpenReceivable(
      input.capital,
      moneyOnStreet,
      input.outstanding
    ),
  };
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

describe("salesOrderInvestedCapitalRecoveryMath — TEST-01..03 (capitalRecovered/moneyOnStreet/percent/status)", () => {
  it("TEST-01 — capital=100, received=40", () => {
    const capital = 100;
    const received = 40;
    const capitalRecovered = computeCapitalRecovered(capital, received);
    assert.equal(capitalRecovered, 40);
    assert.equal(computeMoneyOnStreet(capital, received), 60);
    assert.equal(computeRecoveryPercent(capital, received), 40);
    assert.equal(
      computeInvestedCapitalRecoveryStatus(capital, capitalRecovered),
      "EM_RECUPERACAO"
    );
  });

  it("TEST-02 — capital=100, received=100", () => {
    const capital = 100;
    const received = 100;
    const capitalRecovered = computeCapitalRecovered(capital, received);
    assert.equal(capitalRecovered, 100);
    assert.equal(computeMoneyOnStreet(capital, received), 0);
    assert.equal(computeRecoveryPercent(capital, received), 100);
    assert.equal(
      computeInvestedCapitalRecoveryStatus(capital, capitalRecovered),
      "CAPITAL_RECUPERADO"
    );
  });

  it("TEST-03 — capital=100, received=180 (recebido além do capital não é capital recuperado)", () => {
    const capital = 100;
    const received = 180;
    const capitalRecovered = computeCapitalRecovered(capital, received);
    assert.equal(capitalRecovered, 100);
    assert.equal(computeMoneyOnStreet(capital, received), 0);
    assert.equal(computeRecoveryPercent(capital, received), 100);
    assert.equal(
      computeInvestedCapitalRecoveryStatus(capital, capitalRecovered),
      "CAPITAL_RECUPERADO"
    );
  });

  it("percent nunca excede 100 mesmo em cenários extremos de recebimento acima do capital", () => {
    assert.equal(computeRecoveryPercent(50, 10_000), 100);
  });

  it("SEM_RECUPERACAO quando capitalRecovered == 0 e capital > 0", () => {
    const capitalRecovered = computeCapitalRecovered(100, 0);
    assert.equal(capitalRecovered, 0);
    assert.equal(computeInvestedCapitalRecoveryStatus(100, capitalRecovered), "SEM_RECUPERACAO");
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — TEST-04 (data real de recuperação)", () => {
  it("TEST-04 — 3 eventos reais, recoveryDate = data do evento que atinge o capital", () => {
    const capital = 100;
    const events = [
      { civilDate: "2026-01-01", amount: 30 },
      { civilDate: "2026-02-01", amount: 20 },
      { civilDate: "2026-03-01", amount: 60 },
    ];
    assert.equal(resolveCapitalRecoveryDate(capital, events), "2026-03-01");
  });

  it("ordem de entrada não importa — sempre ordena cronologicamente antes de acumular", () => {
    const capital = 110;
    const events = [
      { civilDate: "2026-08-05", amount: 30 },
      { civilDate: "2026-06-10", amount: 30 },
      { civilDate: "2026-07-25", amount: 25 },
      { civilDate: "2026-07-10", amount: 30 },
    ];
    // 10/06 30=>30; 10/07 30=>60; 25/07 25=>85; 05/08 30=>115 >= 110
    assert.equal(resolveCapitalRecoveryDate(capital, events), "2026-08-05");
  });

  it("capital nunca atingido pelos eventos → null (não inventa data)", () => {
    const capital = 1000;
    const events = [{ civilDate: "2026-01-01", amount: 40 }];
    assert.equal(resolveCapitalRecoveryDate(capital, events), null);
  });

  it("evento real sem data → null (não fabrica precisão que os dados não sustentam)", () => {
    const capital = 100;
    const events = [
      { civilDate: "2026-01-01", amount: 60 },
      { civilDate: null, amount: 50 },
    ];
    assert.equal(resolveCapitalRecoveryDate(capital, events), null);
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — TEST-05 (previsão de recuperação)", () => {
  it("TEST-05 — CR real aberto + previsão válida, forecastRecoveryDate = primeira data que fecha o capital", () => {
    const capital = 100;
    const received = 40;
    const futureAgenda = [
      { civilDate: "2026-08-15", amount: 30 }, // CR real aberto
      { civilDate: "2026-09-15", amount: 30 }, // previsão
      { civilDate: "2026-10-15", amount: 40 }, // previsão
    ];
    // received=40; +15/08 30=>70; +15/09 30=>100 >= 100
    assert.equal(resolveForecastCapitalRecoveryDate(capital, received, futureAgenda), "2026-09-15");
  });

  it("sem cobertura suficiente na agenda conhecida → null", () => {
    const capital = 1000;
    const received = 40;
    const futureAgenda = [{ civilDate: "2026-09-15", amount: 30 }];
    assert.equal(resolveForecastCapitalRecoveryDate(capital, received, futureAgenda), null);
  });

  it("capital já recuperado → não há o que prever (null)", () => {
    const capital = 100;
    const received = 100;
    const futureAgenda = [{ civilDate: "2026-09-15", amount: 30 }];
    assert.equal(resolveForecastCapitalRecoveryDate(capital, received, futureAgenda), null);
  });

  it("fonte da previsão — REAL_AND_FORECAST/REAL_RECEIVABLES/FORECAST_ONLY/NONE", () => {
    assert.equal(
      resolveInvestedCapitalRecoveryForecastSource({ hasOpenRealReceivables: true, hasResidualForecast: true }),
      "REAL_AND_FORECAST"
    );
    assert.equal(
      resolveInvestedCapitalRecoveryForecastSource({ hasOpenRealReceivables: true, hasResidualForecast: false }),
      "REAL_RECEIVABLES"
    );
    assert.equal(
      resolveInvestedCapitalRecoveryForecastSource({ hasOpenRealReceivables: false, hasResidualForecast: true }),
      "FORECAST_ONLY"
    );
    assert.equal(
      resolveInvestedCapitalRecoveryForecastSource({ hasOpenRealReceivables: false, hasResidualForecast: false }),
      "NONE"
    );
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — TEST-07 (reconciliação capital = recuperado + na rua)", () => {
  it("TEST-07 — investedCapital == capitalRecovered + moneyOnStreet, em qualquer cenário", () => {
    const scenarios = [
      { capital: 100, received: 0 },
      { capital: 100, received: 40 },
      { capital: 100, received: 100 },
      { capital: 100, received: 180 },
      { capital: 250.5, received: 99.99 },
    ];
    for (const { capital, received } of scenarios) {
      const capitalRecovered = computeCapitalRecovered(capital, received)!;
      const moneyOnStreet = computeMoneyOnStreet(capital, received)!;
      assert.equal(
        Math.round((capitalRecovered + moneyOnStreet) * 100) / 100,
        capital,
        `capital=${capital} received=${received}`
      );
    }
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — TEST-08 (aging soma o moneyOnStreet)", () => {
  const TODAY = "2026-08-07";

  it("exemplo do enunciado: moneyOnStreet=60, agenda 20 vencido / 30 em 15d / 50 em 70d → 20/30/10, resto ignorado", () => {
    const buckets = distributeMoneyOnStreetAcrossAging({
      moneyOnStreet: 60,
      scheduleEvents: [
        { civilDate: "2026-07-20", amount: 20 }, // vencido (antes de hoje)
        { civilDate: "2026-08-22", amount: 30 }, // +15 dias
        { civilDate: "2026-10-16", amount: 50 }, // +70 dias
      ],
      todayCivilDate: TODAY,
    });
    assert.equal(buckets.overdue, 20);
    assert.equal(buckets.d0to30, 30);
    assert.equal(buckets.d61to90, 10);
    assert.equal(buckets.d31to60, 0);
    assert.equal(buckets.d90plus, 0);
    assert.equal(buckets.noForecast, 0);
    const total = Object.values(buckets).reduce((s, v) => s + v, 0);
    assert.equal(Math.round(total * 100) / 100, 60);
  });

  it("TEST-08 — SUM(agingBuckets) == moneyOnStreet em cenários variados", () => {
    const scenarios = [
      { moneyOnStreet: 0, events: [] },
      { moneyOnStreet: 500, events: [{ civilDate: "2026-08-01", amount: 500 }] },
      {
        moneyOnStreet: 1234.56,
        events: [
          { civilDate: "2026-06-01", amount: 100 },
          { civilDate: "2026-09-01", amount: 100 },
          { civilDate: null, amount: 5000 },
        ],
      },
    ];
    for (const s of scenarios) {
      const buckets = distributeMoneyOnStreetAcrossAging({
        moneyOnStreet: s.moneyOnStreet,
        scheduleEvents: s.events,
        todayCivilDate: TODAY,
      });
      const total = Object.values(buckets).reduce((sum, v) => sum + v, 0);
      assert.equal(Math.round(total * 100) / 100, Math.round(s.moneyOnStreet * 100) / 100);
    }
  });

  it("agenda não cobre o moneyOnStreet inteiro → resto cai em 'Sem previsão', nunca descartado", () => {
    const buckets = distributeMoneyOnStreetAcrossAging({
      moneyOnStreet: 100,
      scheduleEvents: [{ civilDate: "2026-08-10", amount: 30 }],
      todayCivilDate: TODAY,
    });
    assert.equal(buckets.d0to30, 30);
    assert.equal(buckets.noForecast, 70);
  });

  it("evento sem data vira 'Sem previsão' diretamente", () => {
    const buckets = distributeMoneyOnStreetAcrossAging({
      moneyOnStreet: 40,
      scheduleEvents: [{ civilDate: null, amount: 40 }],
      todayCivilDate: TODAY,
    });
    assert.equal(buckets.noForecast, 40);
  });

  it("moneyOnStreet zero → todos os buckets zerados, sem erro", () => {
    const buckets = distributeMoneyOnStreetAcrossAging({
      moneyOnStreet: 0,
      scheduleEvents: [{ civilDate: "2026-08-10", amount: 500 }],
      todayCivilDate: TODAY,
    });
    for (const v of Object.values(buckets)) assert.equal(v, 0);
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — dados incompletos/ausentes (seções 11, 12, 32)", () => {
  it("capital ausente (null) → capitalRecovered/moneyOnStreet/percent são null, status DADOS_INSUFICIENTES", () => {
    assert.equal(computeCapitalRecovered(null, 50), null);
    assert.equal(computeMoneyOnStreet(null, 50), null);
    assert.equal(computeRecoveryPercent(null, 50), null);
    assert.equal(computeInvestedCapitalRecoveryStatus(null, null), "DADOS_INSUFICIENTES");
  });

  it("capital inválido (zero ou negativo) → tratado como ausente, nunca vira 0 silencioso", () => {
    assert.equal(computeCapitalRecovered(0, 50), null);
    assert.equal(computeCapitalRecovered(-10, 50), null);
    assert.equal(computeInvestedCapitalRecoveryStatus(0, null), "DADOS_INSUFICIENTES");
  });

  it("received negativo/NaN é tratado como 0, nunca gera capitalRecovered negativo", () => {
    assert.equal(computeCapitalRecovered(100, -50), 0);
    assert.equal(computeCapitalRecovered(100, Number.NaN), 0);
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — decomposição econômica do PV (CASOS A–E)", () => {
  it("CASO A — venda 100, capital 60, recebido 75, CR aberto 25", () => {
    const d = decompose({ sale: 100, capital: 60, received: 75, outstanding: 25 });
    assert.deepEqual(d, {
      economicMargin: 40,
      capitalRecovered: 60,
      realizedGain: 15,
      moneyOnStreet: 0,
      capitalReceivableCovered: 0,
      gainReceivable: 25,
      capitalWithoutOpenReceivable: 0,
    });
  });

  it("CASO B — venda 100, capital 60, recebido 30, CR aberto 70 (recebível maior que o capital na rua)", () => {
    const d = decompose({ sale: 100, capital: 60, received: 30, outstanding: 70 });
    assert.deepEqual(d, {
      economicMargin: 40,
      capitalRecovered: 30,
      realizedGain: 0,
      moneyOnStreet: 30,
      capitalReceivableCovered: 30,
      gainReceivable: 40,
      capitalWithoutOpenReceivable: 0,
    });
  });

  it("CASO C — venda 100, capital 60, recebido 10, CR aberto 20 (recebível menor que o capital na rua)", () => {
    const d = decompose({ sale: 100, capital: 60, received: 10, outstanding: 20 });
    assert.deepEqual(d, {
      economicMargin: 40,
      capitalRecovered: 10,
      realizedGain: 0,
      moneyOnStreet: 50,
      capitalReceivableCovered: 20,
      gainReceivable: 0,
      capitalWithoutOpenReceivable: 30,
    });
  });

  it("CASO D — capital null: tudo null, nunca ganho artificial por falta de custo", () => {
    const d = decompose({ sale: 100, capital: null, received: 50, outstanding: 50 });
    assert.deepEqual(d, {
      economicMargin: null,
      capitalRecovered: null,
      realizedGain: null,
      moneyOnStreet: null,
      capitalReceivableCovered: null,
      gainReceivable: null,
      capitalWithoutOpenReceivable: null,
    });
    // capital 0 ou negativo = inválido, mesma regra de DADOS_INSUFICIENTES.
    assert.equal(computeEconomicMargin(100, 0), null);
    assert.equal(computeGainReceivable(0, 0, 50), null);
    assert.equal(computeCapitalReceivableCovered(-5, 0, 50), null);
    assert.equal(isValidInvestedCapital(0), false);
    assert.equal(isValidInvestedCapital(null), false);
    assert.equal(isValidInvestedCapital(0.01), true);
  });

  it("CASO E — venda 100, capital 110, recebido 60, CR aberto 40: margem NEGATIVA permanece visível", () => {
    const d = decompose({ sale: 100, capital: 110, received: 60, outstanding: 40 });
    assert.deepEqual(d, {
      economicMargin: -10,
      capitalRecovered: 60,
      realizedGain: 0,
      moneyOnStreet: 50,
      capitalReceivableCovered: 40,
      gainReceivable: 0,
      capitalWithoutOpenReceivable: 10,
    });
  });

  it("capital totalmente recuperado, zero recebido e zero em aberto", () => {
    const full = decompose({ sale: 100, capital: 60, received: 60, outstanding: 40 });
    assert.equal(full.moneyOnStreet, 0);
    assert.equal(full.capitalReceivableCovered, 0);
    assert.equal(full.gainReceivable, 40);
    assert.equal(full.capitalWithoutOpenReceivable, 0);

    const nothing = decompose({ sale: 100, capital: 60, received: 0, outstanding: 0 });
    assert.equal(nothing.capitalRecovered, 0);
    assert.equal(nothing.moneyOnStreet, 60);
    assert.equal(nothing.capitalReceivableCovered, 0);
    assert.equal(nothing.gainReceivable, 0);
    assert.equal(nothing.capitalWithoutOpenReceivable, 60);
    assert.equal(nothing.economicMargin, 40);
  });

  it("moneyOnStreet null (sem capital) → coberto/ganho/sem CR ficam null, nunca 0 silencioso", () => {
    assert.equal(computeCapitalReceivableCovered(60, null, 50), null);
    assert.equal(computeGainReceivable(60, null, 50), null);
    assert.equal(computeCapitalWithoutOpenReceivable(60, null, 50), null);
  });

  it("reconciliações centavo a centavo em cenários variados (inclusive centavos quebrados)", () => {
    const scenarios = [
      { sale: 100, capital: 60, received: 75, outstanding: 25 },
      { sale: 100, capital: 60, received: 30, outstanding: 70 },
      { sale: 100, capital: 60, received: 10, outstanding: 20 },
      { sale: 100, capital: 110, received: 60, outstanding: 40 },
      { sale: 1234.56, capital: 987.65, received: 333.33, outstanding: 901.23 },
      { sale: 0.03, capital: 0.01, received: 0.02, outstanding: 0.01 },
      { sale: 250.5, capital: 250.5, received: 99.99, outstanding: 150.51 },
      { sale: 10, capital: 30, received: 0, outstanding: 0 },
    ];
    for (const s of scenarios) {
      const d = decompose(s);
      const label = JSON.stringify(s);
      assert.equal(cents(d.capitalRecovered! + d.moneyOnStreet!), cents(s.capital!), `capital ${label}`);
      assert.equal(cents(d.capitalRecovered! + d.realizedGain!), cents(s.received), `recebido ${label}`);
      assert.equal(cents(d.capitalReceivableCovered! + d.gainReceivable!), cents(s.outstanding), `CR aberto ${label}`);
      assert.equal(
        cents(d.capitalReceivableCovered! + d.capitalWithoutOpenReceivable!),
        d.moneyOnStreet,
        `na rua ${label}`
      );
      assert.equal(cents(s.capital! + d.economicMargin!), cents(s.sale), `venda ${label}`);
    }
  });
});

describe("salesOrderInvestedCapitalRecoveryMath — capital = custo industrial + imposto (centavo a centavo)", () => {
  it("imposto com meio centavo (6 casas do motor de margem) não deixa a soma um centavo acima", () => {
    // Antes: custo = round(112,53 − 12,525) = 100,01 e imposto = round(12,525) = 12,53 → 112,54 ≠ 112,53.
    const cases = [
      { cost: 100, tax: 12.525 },
      { cost: 100, tax: 10.625 },
      { cost: 73.4, tax: 9.175 },
      { cost: 100.004, tax: 0.004 },
      { cost: 1234.567891, tax: 98.7654321 },
      { cost: 50, tax: 0 },
    ];
    for (const c of cases) {
      const investedCapital = cents(c.cost + c.tax);
      const parts = resolveInvestedCapitalComponents(investedCapital, c.tax);
      assert.equal(parts.totalTaxes, cents(c.tax), JSON.stringify(c));
      assert.equal(cents(parts.industrialCost! + parts.totalTaxes!), investedCapital, JSON.stringify(c));
    }
  });

  it("sem capital resolvido, custo e imposto ficam null (não disfarça custo ausente)", () => {
    assert.deepEqual(resolveInvestedCapitalComponents(null, 12.5), { industrialCost: null, totalTaxes: null });
    assert.deepEqual(resolveInvestedCapitalComponents(Number.NaN, 12.5), { industrialCost: null, totalTaxes: null });
  });

  it("imposto ausente/NaN vira 0 e o custo é o capital inteiro", () => {
    assert.deepEqual(resolveInvestedCapitalComponents(100, null), { industrialCost: 100, totalTaxes: 0 });
    assert.deepEqual(resolveInvestedCapitalComponents(100, Number.NaN), { industrialCost: 100, totalTaxes: 0 });
  });
});
