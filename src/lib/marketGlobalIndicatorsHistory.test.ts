import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  addCivilDays,
  BRENT_PRICE_KIND_LABEL,
  buildMarketGlobalIndicatorsHistory,
  civilDateInSaoPaulo,
  formatBrentPricePt,
  formatCollectedAtPt,
  formatMarketPercentPt,
  formatPtaxRatePt,
  formatQuoteDatePt,
  historyQuoteDateBounds,
  historyWindow,
  parseMarketHistoryRange,
  percentChange,
  quoteDateKey,
  type MarketHistoryBrentInput,
  type MarketHistoryPtaxInput,
} from "./marketGlobalIndicatorsHistory.js";

const NOW = new Date("2026-10-23T02:30:00.000Z");

function ptax(partial: Partial<MarketHistoryPtaxInput> & Pick<MarketHistoryPtaxInput, "id" | "quoteDate">): MarketHistoryPtaxInput {
  return {
    status: "SUCCESS",
    buyRate: 5.1,
    sellRate: 5.2,
    source: "BCB PTAX",
    collectedAt: "2026-10-22T21:00:00.000Z",
    ...partial,
  };
}

function brent(partial: Partial<MarketHistoryBrentInput> & Pick<MarketHistoryBrentInput, "id" | "quoteDate">): MarketHistoryBrentInput {
  return {
    status: "SUCCESS",
    priceUSD: 80,
    source: "yahoo-finance",
    collectedAt: "2026-10-22T21:00:00.000Z",
    ...partial,
  };
}

function history(ptaxRows: MarketHistoryPtaxInput[], brentRows: MarketHistoryBrentInput[] = [], now = NOW) {
  return buildMarketGlobalIndicatorsHistory({ range: "30d", now, ptaxRows, brentRows });
}

describe("janela e datas do histórico", () => {
  it("30 dias inclui o dia civil de São Paulo e não o dia UTC seguinte", () => {
    assert.equal(civilDateInSaoPaulo(NOW), "2026-10-22");
    const window = historyWindow("30d", NOW);
    assert.equal(window.end, "2026-10-22");
    assert.equal(window.start, "2026-09-23");
    assert.equal(window.days, 30);
    assert.equal(addCivilDays(window.end, -29), window.start);
  });

  it("aceita 7 e 90 dias e rejeita intervalo livre", () => {
    assert.equal(historyWindow("7d", NOW).start, "2026-10-16");
    assert.equal(historyWindow("90d", NOW).days, 90);
    assert.deepEqual(parseMarketHistoryRange(undefined), { ok: true, range: "30d" });
    assert.deepEqual(parseMarketHistoryRange("7d"), { ok: true, range: "7d" });
    assert.deepEqual(parseMarketHistoryRange("90d"), { ok: true, range: "90d" });
    assert.deepEqual(parseMarketHistoryRange("365d"), { ok: false, error: "INVALID_RANGE" });
    assert.deepEqual(parseMarketHistoryRange(["30d"]), { ok: false, error: "INVALID_RANGE" });
  });

  it("preserva a data econômica da coluna date mesmo à meia-noite UTC", () => {
    assert.equal(quoteDateKey(new Date("2026-10-22T00:00:00.000Z")), "2026-10-22");
    assert.equal(quoteDateKey(new Date("2026-10-22T12:00:00.000Z")), "2026-10-22");
    assert.equal(quoteDateKey("2026-10-22"), "2026-10-22");
  });

  it("os limites da consulta incluem o dia inicial e o final gravados ao meio-dia UTC", () => {
    const bounds = historyQuoteDateBounds("2026-09-23", "2026-10-22");
    const first = new Date("2026-09-23T12:00:00.000Z");
    const last = new Date("2026-10-22T12:00:00.000Z");
    assert.ok(first >= bounds.gte && first < bounds.lte);
    assert.ok(last <= bounds.lte);
    assert.ok(first >= bounds.priorBefore);
    assert.ok(new Date("2026-09-22T12:00:00.000Z") < bounds.priorBefore);
  });
});

describe("consolidação diária", () => {
  it("fica com o último snapshot válido do dia e desempatado pelo id", () => {
    const built = history([
      ptax({
        id: "a",
        quoteDate: "2026-10-21",
        sellRate: 5.1,
        buyRate: 5,
        collectedAt: "2026-10-21T18:00:00.000Z",
      }),
      ptax({
        id: "b",
        quoteDate: "2026-10-21",
        sellRate: 5.4,
        buyRate: 5.3,
        collectedAt: "2026-10-21T21:00:00.000Z",
      }),
      ptax({
        id: "m",
        quoteDate: "2026-10-22",
        sellRate: 5,
        buyRate: 4.9,
        collectedAt: "2026-10-22T21:00:00.000Z",
      }),
      ptax({
        id: "z",
        quoteDate: "2026-10-22",
        sellRate: 5.6,
        buyRate: 5.5,
        collectedAt: "2026-10-22T21:00:00.000Z",
      }),
    ]);
    assert.deepEqual(
      built.ptax.points.map((point) => [point.quoteDate, point.sellRate, point.buyRate]),
      [
        ["2026-10-21", 5.4, 5.3],
        ["2026-10-22", 5.6, 5.5],
      ]
    );
  });

  it("descarta falha, nulo, zero e negativo e não inventa o dia sem cotação", () => {
    const built = history([
      ptax({ id: "ok", quoteDate: "2026-10-20", sellRate: 5.2, buyRate: 5.1 }),
      ptax({ id: "fail", quoteDate: "2026-10-21", status: "FAILED", sellRate: 9, buyRate: 9 }),
      ptax({ id: "null", quoteDate: "2026-10-21", sellRate: null, buyRate: 5 }),
      ptax({ id: "zero", quoteDate: "2026-10-21", sellRate: 0, buyRate: 5 }),
      ptax({ id: "neg", quoteDate: "2026-10-21", sellRate: -1, buyRate: 5 }),
      ptax({ id: "fri", quoteDate: "2026-10-16", sellRate: 5, buyRate: 4.9 }),
    ]);
    assert.deepEqual(built.ptax.points.map((point) => point.quoteDate), ["2026-10-16", "2026-10-20"]);
  });

  it("atribui a PTAX à data da cotação, não à data da coleta", () => {
    const built = history([
      ptax({
        id: "late",
        quoteDate: "2026-10-21",
        collectedAt: "2026-10-22T12:00:00.000Z",
        sellRate: 5.25,
        buyRate: 5.15,
      }),
    ]);
    assert.equal(built.ptax.points.length, 1);
    assert.equal(built.ptax.points[0]?.quoteDate, "2026-10-21");
    assert.notEqual(built.ptax.points[0]?.quoteDate, "2026-10-22");
  });

  it("Brent usa a última coleta do dia e ignora comparação intradiária", () => {
    const built = history([], [
      brent({
        id: "early",
        quoteDate: "2026-10-21",
        priceUSD: 70,
        collectedAt: "2026-10-21T10:00:00.000Z",
      }),
      brent({
        id: "late",
        quoteDate: "2026-10-21",
        priceUSD: 77,
        collectedAt: "2026-10-21T19:00:00.000Z",
      }),
      brent({
        id: "next",
        quoteDate: "2026-10-22",
        priceUSD: 80,
        collectedAt: "2026-10-22T19:00:00.000Z",
      }),
    ]);
    assert.equal(built.brent.points[0]?.priceUsd, 77);
    assert.equal(built.brent.points[1]?.priceUsd, 80);
    assert.equal(built.brent.priceKindLabel, BRENT_PRICE_KIND_LABEL);
    assert.ok(Math.abs((built.brent.points[1]?.dailyChangePct ?? 0) - percentChange(80, 77)!) < 1e-9);
  });

  it("fim de semana e feriado permanecem buracos, sem repetir o último preço", () => {
    const built = history(
      [
        ptax({ id: "fri", quoteDate: "2026-10-16", sellRate: 5, buyRate: 4.9 }),
        ptax({ id: "mon", quoteDate: "2026-10-19", sellRate: 5.1, buyRate: 5 }),
      ],
      [
        brent({ id: "before-holiday", quoteDate: "2026-10-11", priceUSD: 75 }),
        brent({ id: "after-holiday", quoteDate: "2026-10-14", priceUSD: 76 }),
      ]
    );
    assert.equal(built.ptax.points.length, 2);
    assert.equal(built.brent.points.length, 2);
    assert.equal(built.ptax.points.some((point) => point.quoteDate === "2026-10-17"), false);
    assert.equal(built.brent.points.some((point) => point.quoteDate === "2026-10-12"), false);
  });

  it("ordena cronologicamente mesmo com a entrada embaralhada", () => {
    const built = history([
      ptax({ id: "c", quoteDate: "2026-10-22", sellRate: 5.3, buyRate: 5.2 }),
      ptax({ id: "a", quoteDate: "2026-10-20", sellRate: 5.1, buyRate: 5 }),
      ptax({ id: "b", quoteDate: "2026-10-21", sellRate: 5.2, buyRate: 5.1 }),
    ]);
    assert.deepEqual(built.ptax.points.map((point) => point.quoteDate), [
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
  });
});

describe("variações", () => {
  it("calcula alta, queda, zero legítimo e ausência de base", () => {
    assert.equal(percentChange(5, null), null);
    assert.ok(Math.abs(percentChange(5.1, 5)! - 2) < 1e-9);
    assert.ok(Math.abs(percentChange(4.9, 5)! - -2) < 1e-9);
    assert.equal(percentChange(5, 5), 0);
    assert.equal(percentChange(5, 0), null);

    const built = history([
      ptax({ id: "1", quoteDate: "2026-10-20", sellRate: 5, buyRate: 4.8 }),
      ptax({ id: "2", quoteDate: "2026-10-21", sellRate: 5, buyRate: 4.9 }),
      ptax({ id: "3", quoteDate: "2026-10-22", sellRate: 5.1, buyRate: 4.7 }),
    ]);
    assert.equal(built.ptax.points[0]?.sellDailyChangePct, null);
    assert.equal(built.ptax.points[1]?.sellDailyChangePct, 0);
    assert.ok(Math.abs(built.ptax.points[2]!.sellDailyChangePct! - 2) < 1e-9);
    assert.ok(Math.abs(built.ptax.sell.accumulatedChangePct! - 2) < 1e-9);
    assert.equal(built.ptax.sell.min?.quoteDate, "2026-10-20");
    assert.equal(built.ptax.sell.max?.quoteDate, "2026-10-22");
  });

  it("a cotação anterior à janela entra na variação diária e fica fora do gráfico e do acumulado", () => {
    const built = buildMarketGlobalIndicatorsHistory({
      range: "7d",
      now: NOW,
      ptaxRows: [
        ptax({ id: "old", quoteDate: "2026-10-10", sellRate: 4, buyRate: 3.9 }),
        ptax({ id: "first", quoteDate: "2026-10-20", sellRate: 5, buyRate: 4.9 }),
        ptax({ id: "last", quoteDate: "2026-10-22", sellRate: 5.5, buyRate: 5.4 }),
      ],
      brentRows: [],
    });
    assert.deepEqual(built.ptax.points.map((point) => point.quoteDate), ["2026-10-20", "2026-10-22"]);
    assert.ok(Math.abs(built.ptax.points[0]!.sellDailyChangePct! - 25) < 1e-9);
    assert.ok(Math.abs(built.ptax.sell.accumulatedChangePct! - 10) < 1e-9);
  });

  it("série vazia e série de um ponto não fabricam tendência nem zero por cento", () => {
    const empty = history([]);
    assert.equal(empty.ptax.points.length, 0);
    assert.equal(empty.ptax.sell.observationCount, 0);
    assert.equal(empty.ptax.sell.dailyChangePct, null);
    assert.equal(empty.ptax.sell.accumulatedChangePct, null);
    assert.equal(empty.brent.summary.min, null);

    const single = history([ptax({ id: "only", quoteDate: "2026-10-22", sellRate: 5.4321, buyRate: 5.4 })]);
    assert.equal(single.ptax.points.length, 1);
    assert.equal(single.ptax.sell.dailyChangePct, null);
    assert.equal(single.ptax.sell.accumulatedChangePct, null);
    assert.equal(single.ptax.sell.amplitudePct, null);
    assert.equal(single.ptax.sell.min?.value, 5.4321);
    assert.equal(single.ptax.sell.max?.value, 5.4321);
  });

  it("não devolve mais pontos do que os dias do período nem datas fora da janela", () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      ptax({
        id: `d${index}`,
        quoteDate: addCivilDays("2026-09-20", index),
        sellRate: 5 + index / 100,
        buyRate: 4.9,
      })
    );
    const built = buildMarketGlobalIndicatorsHistory({
      range: "7d",
      now: NOW,
      ptaxRows: rows,
      brentRows: [],
    });
    assert.ok(built.ptax.points.length <= 7);
    assert.ok(built.ptax.points.length > 0);
    assert.ok(
      built.ptax.points.every(
        (point) => point.quoteDate >= built.windowStart && point.quoteDate <= built.windowEnd
      )
    );
  });

  it("empate de mínimo fica com a data mais antiga", () => {
    const built = history([
      ptax({ id: "a", quoteDate: "2026-10-20", sellRate: 5, buyRate: 4.9 }),
      ptax({ id: "b", quoteDate: "2026-10-21", sellRate: 5.2, buyRate: 5 }),
      ptax({ id: "c", quoteDate: "2026-10-22", sellRate: 5, buyRate: 4.8 }),
    ]);
    assert.equal(built.ptax.sell.min?.quoteDate, "2026-10-20");
    assert.equal(built.ptax.sell.max?.quoteDate, "2026-10-21");
  });
});

describe("formatação pt-BR", () => {
  it("formata PTAX com 4 casas, Brent com 2 e percentual com sinal", () => {
    assert.equal(formatPtaxRatePt(5.4321), "R$ 5,4321");
    assert.equal(formatBrentPricePt(80.5), "US$ 80,50");
    assert.equal(formatMarketPercentPt(1.2), "+1,20%");
    assert.equal(formatMarketPercentPt(-0.5), "-0,50%");
    assert.equal(formatMarketPercentPt(0), "0,00%");
    assert.equal(formatMarketPercentPt(null), null);
    assert.equal(formatQuoteDatePt("2026-10-22"), "22/10/2026");
    assert.match(formatCollectedAtPt("2026-10-23T02:30:00.000Z"), /22\/10\/2026/);
  });
});

describe("isolamento das coletas", () => {
  it("o motor histórico não chama coletor, agenda nem fonte externa", () => {
    const root = process.cwd();
    const historySource = readFileSync(join(root, "src/lib/marketGlobalIndicatorsHistory.ts"), "utf8");
    const serverSource = readFileSync(join(root, "src/lib/marketGlobalIndicatorsHistory.server.ts"), "utf8");
    const combined = `${historySource}\n${serverSource}`;
    assert.doesNotMatch(combined, /collectPtaxSnapshot|collectBrentCommoditySnapshot|yahoo|bcb\.gov|setInterval/);
    assert.match(serverSource, /findMany/);
    assert.doesNotMatch(serverSource, /\.(create|update|delete|upsert)\(/);
    const ptaxJob = readFileSync(join(root, "src/lib/ptaxSnapshotJob.ts"), "utf8");
    const brentJob = readFileSync(join(root, "src/lib/brentCommodityJob.ts"), "utf8");
    assert.match(ptaxJob, /label: "09:00"/);
    assert.match(ptaxJob, /label: "15:30"/);
    assert.match(brentJob, /label: "07:00"/);
    assert.match(brentJob, /label: "16:00"/);
  });
});
