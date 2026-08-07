import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCapitalRecovered,
  computeInvestedCapitalRecoveryStatus,
  computeMoneyOnStreet,
  computeRecoveryPercent,
  distributeMoneyOnStreetAcrossAging,
  resolveCapitalRecoveryDate,
  resolveForecastCapitalRecoveryDate,
  resolveInvestedCapitalRecoveryForecastSource,
} from "./salesOrderInvestedCapitalRecoveryMath.js";

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
