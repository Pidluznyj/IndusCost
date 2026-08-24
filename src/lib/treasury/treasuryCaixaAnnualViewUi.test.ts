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
