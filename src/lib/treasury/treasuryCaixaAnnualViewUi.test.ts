/**
 * Visão Anual da Caixa — regressão.
 *
 * Trava os contratos da missão:
 *  1. range anual = ano civil inteiro (bissexto incluso), via motor oficial;
 *  2. a série anual é a MESMA cadeia canônica do gráfico da página
 *     (equivalência por construção, provada com fixture);
 *  3. KPIs derivam da própria série (nenhuma consulta/regra paralela);
 *  4. gates estruturais: modal lazy, zero fetch fora do "Gerar gráfico",
 *     AbortController presente, endpoint canônico reutilizado, mesmo
 *     componente visual de gráfico.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  appendTreasuryCaixaDailyDueEstimates,
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  resolveTreasuryCaixaDueDateRange,
  type TreasuryCaixaBalanceChartPoint,
  type TreasuryCaixaTimelineMonth,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { buildTreasuryCaixaUrl } from "@/src/lib/treasury/treasuryCaixaApi.js";
import type { TreasuryCaixaPayload } from "@/src/lib/treasury/treasuryCaixaApi.js";
import {
  buildTreasuryCaixaAnnualSeries,
  buildTreasuryCaixaTimelineFromBoardSources,
  deriveTreasuryCaixaAnnualKpis,
} from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";

function daysBetweenInclusive(from: Date, to: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS) + 1;
}

describe("visão anual — range de ano civil", () => {
  it("year sem mês/dia cobre 01/01 a 31/12 (365 dias em 2026)", () => {
    const range = resolveTreasuryCaixaDueDateRange({ year: 2026 });
    assert.equal(range.dueDateFrom.getMonth(), 0);
    assert.equal(range.dueDateFrom.getDate(), 1);
    assert.equal(range.dueDateTo.getMonth(), 11);
    assert.equal(range.dueDateTo.getDate(), 31);
    assert.equal(daysBetweenInclusive(range.dueDateFrom, range.dueDateTo), 365);
  });

  it("ano bissexto (2028) cobre 366 dias — 29/02 incluso", () => {
    const range = resolveTreasuryCaixaDueDateRange({ year: 2028 });
    assert.equal(daysBetweenInclusive(range.dueDateFrom, range.dueDateTo), 366);
  });

  it("a URL da visão anual envia SÓ year — sem month/day", () => {
    const url = buildTreasuryCaixaUrl({ year: 2027 });
    assert.ok(url.includes("year=2027"));
    assert.ok(!url.includes("month="), "month não deve ir na visão anual");
    assert.ok(!url.includes("day="), "day não deve ir na visão anual");
  });
});

/* ------------------------------------------------------------------ */
/*  Fixture mínimo do board — dois meses realizados + estimativa futura */
/* ------------------------------------------------------------------ */

function realizedDay(
  civilDate: string,
  inflows: number,
  outflows: number,
  opening: number,
  closing: number
) {
  return {
    civilDate,
    inflows,
    outflows,
    receivableCount: 1,
    payableCount: 1,
    opening,
    closing,
    closingCalculated: closing,
    closingInformed: null,
  };
}

function buildBoardFixture(): TreasuryCaixaPayload {
  return {
    period: { year: 2024 },
    dueDateFrom: "2024-01-01",
    dueDateTo: "2024-12-31",
    realizedDays: [
      realizedDay("2024-01-10", 1000, 200, 0, 800),
      realizedDay("2024-01-20", 500, 100, 800, 1200),
      realizedDay("2024-02-05", 0, 1500, 1200, -300),
      realizedDay("2024-03-15", 2000, 100, -300, 1600),
    ],
    dailyDueEstimates: [
      { civilDate: "2024-04-10", estimatedInflow: 300, estimatedOutflow: 50 },
    ],
    canonicalDays: [],
  } as unknown as TreasuryCaixaPayload;
}

describe("visão anual — equivalência com a cadeia canônica da página", () => {
  it("buildTreasuryCaixaAnnualSeries ≡ mesma composição feita manualmente (mesmas funções, mesma ordem)", () => {
    const board = buildBoardFixture();

    const annual = buildTreasuryCaixaAnnualSeries({
      board,
      todayFlowRaw: null,
      agendaDays: [],
    });

    // Réplica manual EXATA da cadeia da página (TreasuryCaixaPage):
    const base = buildTreasuryCaixaTimelineFromBoardSources(board, null, []);
    const timeline = appendTreasuryCaixaDailyDueEstimates(
      base,
      board.dailyDueEstimates ?? []
    );
    const months = buildTreasuryCaixaMonthlyTimeline(timeline.rows);
    const points = buildTreasuryCaixaMonthlyBalanceChart(months);

    assert.deepEqual(
      JSON.parse(JSON.stringify(annual.points)),
      JSON.parse(JSON.stringify(points)),
      "pontos do gráfico anual divergiram da cadeia da página"
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(annual.months)),
      JSON.parse(JSON.stringify(months)),
      "meses da visão anual divergiram da cadeia da página"
    );
    assert.ok(annual.points.length >= 3, "fixture deveria produzir meses");
  });
});

describe("visão anual — KPIs derivados da própria série", () => {
  function month(
    monthKey: string,
    opening: number | null,
    closing: number | null
  ): TreasuryCaixaTimelineMonth {
    return {
      monthKey,
      kind: "REALIZED",
      opening,
      inflows: 0,
      outflows: 0,
      closing,
      divergence: null,
      divergentDayCount: 0,
    } as TreasuryCaixaTimelineMonth;
  }
  function point(
    monthKey: string,
    label: string,
    closingBalance: number,
    isForecast: boolean
  ): TreasuryCaixaBalanceChartPoint {
    return {
      monthKey,
      label,
      closingBalance,
      kind: isForecast ? "ESTIMATED" : "REALIZED",
      isForecast,
    } as TreasuryCaixaBalanceChartPoint;
  }

  it("saldo inicial, menor saldo (com mês), saldo final e rótulo previsto", () => {
    const kpis = deriveTreasuryCaixaAnnualKpis({
      months: [
        month("2026-01", 500, 800),
        month("2026-02", 800, -300),
        month("2026-03", -300, 1600),
      ],
      points: [
        point("2026-01", "jan/26", 800, false),
        point("2026-02", "fev/26", -300, false),
        point("2026-03", "mar/26", 1600, true),
      ],
    });
    assert.equal(kpis.initialBalance, 500);
    assert.equal(kpis.lowestBalance, -300);
    assert.equal(kpis.lowestBalanceLabel, "fev/26");
    assert.equal(kpis.lowestBalanceIsForecast, false);
    assert.equal(kpis.finalBalance, 1600);
    assert.equal(kpis.finalBalanceIsForecast, true, "último ponto é previsto");
  });

  it("primeiro mês sem saldo acumulado não vira saldo inicial (pula para o primeiro com opening)", () => {
    const kpis = deriveTreasuryCaixaAnnualKpis({
      months: [month("2026-01", null, null), month("2026-02", 900, 950)],
      points: [point("2026-02", "fev/26", 950, false)],
    });
    assert.equal(kpis.initialBalance, 900);
  });

  it("dataset vazio → tudo null, nada explode", () => {
    const kpis = deriveTreasuryCaixaAnnualKpis({ months: [], points: [] });
    assert.equal(kpis.initialBalance, null);
    assert.equal(kpis.lowestBalance, null);
    assert.equal(kpis.lowestBalanceLabel, null);
    assert.equal(kpis.finalBalance, null);
    assert.equal(kpis.finalBalanceIsForecast, false);
  });

  it("ano todo negativo: menor saldo é o mais negativo, não zero", () => {
    const kpis = deriveTreasuryCaixaAnnualKpis({
      months: [month("2026-01", -10, -50)],
      points: [
        point("2026-01", "jan/26", -50, false),
        point("2026-02", "fev/26", -20, true),
      ],
    });
    assert.equal(kpis.lowestBalance, -50);
    assert.equal(kpis.lowestBalanceLabel, "jan/26");
  });
});

/* ------------------------------------------------------------------ */
/*  Slicer de período — recorte local, sincronização e clamp           */
/* ------------------------------------------------------------------ */

import {
  annualRangeToCivilDates,
  civilDateToAnnualIndex,
  matchAnnualPreset,
  normalizeAnnualRange,
  resolveAnnualPresetRange,
  sliceTreasuryCaixaAnnualSeries,
  TREASURY_CAIXA_ANNUAL_PRESETS,
} from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";

function fullYearPoints(year: number): TreasuryCaixaBalanceChartPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return {
      monthKey: `${year}-${mm}`,
      label: `m${mm}/${String(year).slice(2)}`,
      closingBalance: (i + 1) * 100 * (i === 4 ? -1 : 1), // maio negativo
      kind: i < 6 ? "REALIZED" : "ESTIMATED",
      isForecast: i >= 6,
    } as TreasuryCaixaBalanceChartPoint;
  });
}

function preset(key: string) {
  const p = TREASURY_CAIXA_ANNUAL_PRESETS.find((x) => x.key === key);
  assert.ok(p, `preset ${key} existe`);
  return p!;
}

describe("visão anual — slicer de período (recorte local)", () => {
  const points = fullYearPoints(2026);

  it("SLICER_YEAR_FULL: preset Ano inteiro cobre 01/01–31/12", () => {
    const r = resolveAnnualPresetRange(points, preset("full"));
    assert.deepEqual(r, { startIndex: 0, endIndex: 11 });
    assert.deepEqual(annualRangeToCivilDates(points, r), {
      fromCivil: "2026-01-01",
      toCivil: "2026-12-31",
    });
  });

  it("PRESET_SYNC: Q1..Q4 produzem as datas civis exatas", () => {
    const cases: Array<[string, string, string]> = [
      ["q1", "2026-01-01", "2026-03-31"],
      ["q2", "2026-04-01", "2026-06-30"],
      ["q3", "2026-07-01", "2026-09-30"],
      ["q4", "2026-10-01", "2026-12-31"],
    ];
    for (const [key, from, to] of cases) {
      const r = resolveAnnualPresetRange(points, preset(key));
      assert.deepEqual(
        annualRangeToCivilDates(points, r),
        { fromCivil: from, toCivil: to },
        `preset ${key}`
      );
      assert.equal(matchAnnualPreset(points, r), key, `highlight de ${key}`);
    }
  });

  it("LEAP_YEAR: 2028 — fevereiro fecha em 29/02 e 29/02 seleciona fevereiro", () => {
    const leap = fullYearPoints(2028);
    const r = normalizeAnnualRange(12, { startIndex: 0, endIndex: 1 });
    assert.deepEqual(annualRangeToCivilDates(leap, r), {
      fromCivil: "2028-01-01",
      toCivil: "2028-02-29",
    });
    assert.equal(civilDateToAnnualIndex(leap, "2028-02-29"), 1);
  });

  it("DATE_SYNC/CUSTOM_RANGE: data civil seleciona o mês correspondente (brush segue)", () => {
    assert.equal(civilDateToAnnualIndex(points, "2026-08-15"), 7);
    assert.equal(civilDateToAnnualIndex(points, "2026-11-01"), 10);
    const custom = normalizeAnnualRange(12, { startIndex: 7, endIndex: 10 });
    assert.deepEqual(annualRangeToCivilDates(points, custom), {
      fromCivil: "2026-08-01",
      toCivil: "2026-11-30",
    });
    assert.equal(matchAnnualPreset(points, custom), null, "custom sem preset");
  });

  it("INVALID_RANGE: start>end é corrigido por troca — nunca estado vazio", () => {
    assert.deepEqual(normalizeAnnualRange(12, { startIndex: 9, endIndex: 2 }), {
      startIndex: 2,
      endIndex: 9,
    });
    assert.deepEqual(
      normalizeAnnualRange(12, { startIndex: Number.NaN, endIndex: 5 }),
      { startIndex: 0, endIndex: 5 },
      "NaN vira limite válido"
    );
  });

  it("OUTSIDE_YEAR: data fora do ano é clampada ao limite da série", () => {
    assert.equal(civilDateToAnnualIndex(points, "2025-12-31"), 0);
    assert.equal(civilDateToAnnualIndex(points, "2027-01-01"), 11);
    assert.equal(civilDateToAnnualIndex(points, "abc"), null, "não-parseável");
    assert.deepEqual(
      normalizeAnnualRange(12, { startIndex: -4, endIndex: 99 }),
      { startIndex: 0, endIndex: 11 }
    );
  });

  it("SEMANTIC_EQUIVALENCE: o recorte é EXATAMENTE os pontos da série original", () => {
    const months = points.map(
      (p) =>
        ({
          monthKey: p.monthKey,
          kind: p.kind,
          opening: p.closingBalance - 10,
          inflows: 0,
          outflows: 0,
          closing: p.closingBalance,
          divergence: null,
          divergentDayCount: 0,
        }) as TreasuryCaixaTimelineMonth
    );
    const sliced = sliceTreasuryCaixaAnnualSeries(
      { months, points },
      { startIndex: 3, endIndex: 5 }
    );
    assert.deepEqual(sliced.points, points.slice(3, 6), "pontos = slice puro");
    assert.deepEqual(
      sliced.months.map((m) => m.monthKey),
      ["2026-04", "2026-05", "2026-06"]
    );
    // Nenhum valor recalculado: referência aos MESMOS objetos do motor.
    assert.equal(sliced.points[0], points[3]);
  });

  it("KPI_FILTER: KPIs recalculados SÓ sobre o período visível", () => {
    const months = points.map(
      (p, i) =>
        ({
          monthKey: p.monthKey,
          kind: p.kind,
          opening: 1000 + i,
          inflows: 0,
          outflows: 0,
          closing: p.closingBalance,
          divergence: null,
          divergentDayCount: 0,
        }) as TreasuryCaixaTimelineMonth
    );
    const q2 = resolveAnnualPresetRange(points, preset("q2"));
    const kpis = deriveTreasuryCaixaAnnualKpis(
      sliceTreasuryCaixaAnnualSeries({ months, points }, q2)
    );
    assert.equal(kpis.initialBalance, 1003, "abertura do 1º mês do recorte");
    assert.equal(kpis.lowestBalance, -500, "maio negativo DENTRO do Q2");
    assert.equal(kpis.lowestBalanceLabel, "m05/26");
    assert.equal(kpis.finalBalance, 600, "fechamento de junho");
    // Fora do recorte (Q4) o menor saldo NÃO pode enxergar maio:
    const q4 = resolveAnnualPresetRange(points, preset("q4"));
    const kpisQ4 = deriveTreasuryCaixaAnnualKpis(
      sliceTreasuryCaixaAnnualSeries({ months, points }, q4)
    );
    assert.equal(kpisQ4.lowestBalance, 1000, "menor saldo do Q4, não do ano");
  });
});

/* ------------------------------------------------------------------ */
/*  Gates estruturais — lazy, zero fetch antecipado, endpoint canônico */
/* ------------------------------------------------------------------ */

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("visão anual — gates estruturais", () => {
  const page = readSource(
    "../../components/finance/treasury/TreasuryCaixaPage.tsx"
  );
  const modal = readSource(
    "../../components/finance/treasury/TreasuryCaixaAnnualViewModal.tsx"
  );
  const ui = readSource("./treasuryCaixaAnnualViewUi.ts");

  it("página carrega o modal por React.lazy — sem import estático", () => {
    assert.ok(
      /React\.lazy\(\(\)\s*=>\s*\n?\s*import\(/.test(page),
      "page deveria usar React.lazy(() => import(...))"
    );
    assert.ok(
      page.includes("TreasuryCaixaAnnualViewModal"),
      "page deveria referenciar o modal anual"
    );
    assert.ok(
      !/^import[^\n]*TreasuryCaixaAnnualViewModal[^\n]*from/m.test(page),
      "import ESTÁTICO do modal derrota o code-splitting"
    );
  });

  it("modal não faz fetch no mount/abertura — fetch mora só no handler de Gerar", () => {
    assert.ok(
      !/useEffect\([\s\S]{0,800}?fetchTreasuryCaixa/.test(modal),
      "fetch dentro de useEffect = request sem clicar em Gerar"
    );
    assert.ok(
      /handleGenerate/.test(modal) &&
        /onClick=\{\(\)\s*=>\s*void handleGenerate\(\)\}/.test(modal),
      "o fetch deve ser disparado pelo clique em Gerar gráfico"
    );
  });

  it("modal usa o endpoint canônico do board e a agenda oficial — nenhum endpoint novo", () => {
    assert.ok(modal.includes("fetchTreasuryCaixa("), "endpoint do board");
    assert.ok(modal.includes("fetchTreasuryAgenda("), "agenda canônica");
    assert.ok(
      !modal.includes('"/api/'),
      "nenhum path de API novo hardcoded no modal"
    );
  });

  it("modal protege corrida: AbortController + sequência", () => {
    assert.ok(modal.includes("AbortController"), "AbortController ausente");
    assert.ok(modal.includes("seqRef"), "guarda de sequência ausente");
  });

  it("SLICER_FETCH_COUNT: mover o slicer não dispara request — só 2 fetches no modal (board+agenda), ambos no Gerar", () => {
    const calls = modal.match(/fetchTreasury\w+\(/g) ?? [];
    assert.equal(
      calls.length,
      2,
      `modal deveria ter exatamente 2 chamadas fetch (board+agenda), achou ${calls.length}`
    );
    assert.ok(
      !/setRange[\s\S]{0,200}?fetchTreasury/.test(modal) &&
        !/onChange[^\n]*fetchTreasury/.test(modal),
      "interação do slicer não pode disparar fetch"
    );
    assert.ok(
      modal.includes("sliceTreasuryCaixaAnnualSeries"),
      "recorte deve ser o slice LOCAL da série carregada"
    );
  });

  it("BRUSH_SYNC: gráfico oficial ganhou Brush opt-in e o modal o controla", () => {
    const chart = readSource(
      "../../components/finance/treasury/TreasuryCaixaBalanceChart.tsx"
    );
    assert.ok(/\bBrush\b/.test(chart), "Brush do Recharts no gráfico oficial");
    assert.ok(
      chart.includes("brush?:"),
      "prop de brush deve ser OPCIONAL — página atual não muda"
    );
    assert.ok(
      modal.includes("brush={{"),
      "modal deve controlar o brush (startIndex/endIndex/onChange)"
    );
  });

  it("modal renderiza o MESMO componente de gráfico da página", () => {
    assert.ok(
      modal.includes("TreasuryCaixaBalanceChart"),
      "o gráfico anual deve ser o TreasuryCaixaBalanceChart oficial"
    );
  });

  it("composição anual usa só o motor canônico — sem fetch e sem regra própria", () => {
    assert.ok(
      !/\bfetch\w*\(/.test(ui),
      "Ui da visão anual não faz I/O (nenhuma chamada fetch*)"
    );
    assert.ok(
      ui.includes("buildTreasuryCaixaUnifiedTimeline") &&
        ui.includes("buildTreasuryCaixaMonthlyBalanceChart") &&
        ui.includes("appendTreasuryCaixaDailyDueEstimates"),
      "cadeia canônica incompleta"
    );
  });

  it("página monta a série do gráfico pela MESMA composição compartilhada", () => {
    assert.ok(
      page.includes("buildTreasuryCaixaTimelineFromBoardSources"),
      "page deveria usar a composição compartilhada (fonte única)"
    );
    assert.ok(
      !/function buildTimelineFromSources\(/.test(page),
      "composição local da page deveria ter sido movida para o Ui compartilhado"
    );
  });
});
