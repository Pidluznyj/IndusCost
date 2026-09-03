/**
 * RED — a linha TODAY da linha do tempo unificada (`buildTreasuryCaixaUnifiedTimeline`)
 * passa a vir da AUTORIDADE ÚNICA de saldos (`todayBalance`), a MESMA cadeia que
 * já resolve os dias passados — não mais do `todayFlow` legado (`/today/closing`).
 *
 * Reproduz o defeito de produção observado em 03/09/2026: o card "Caixa hoje"
 * (autoridade única) e a linha "Começou" de hoje na "Linha do tempo" (antes
 * calculada por um caminho separado) podiam divergir porque vinham de fontes
 * diferentes. `buildTreasuryCaixaUnifiedTimeline` hoje só lê `input.todayFlow`
 * — os testes abaixo fixam o contrato que falta implementar (RC5) e a
 * propagação dos novos campos de proveniência/cobertura nas linhas REALIZED e
 * no agrupamento mensal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TreasuryCaixaDayFlow,
  TreasuryCaixaRealizedDay,
  TreasuryCaixaTimelineRow,
} from "./treasuryCaixaRules.js";
import {
  buildTreasuryCaixaMonthlyTimeline,
  buildTreasuryCaixaUnifiedTimeline,
} from "./treasuryCaixaRules.js";
import type {
  TreasuryBalanceCoverage,
  TreasuryConsolidatedAccountRef,
  TreasuryDailyBalanceAuthorityDay,
} from "./treasuryDailyBalanceAuthority.js";
import { emptyTreasuryBalanceCoverage } from "./treasuryDailyBalanceAuthority.js";

/** Referência de "hoje" compartilhada pelos testes deste arquivo. */
const TODAY = "2026-08-07";

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Cobertura completa mínima (1/1); o teste sobrescreve o que importa. */
function fullCoverage(
  over: Partial<TreasuryBalanceCoverage> = {}
): TreasuryBalanceCoverage {
  return {
    accountsExpected: 1,
    accountsCovered: 1,
    complete: true,
    accounts: [],
    pendingAccounts: [],
    partialSum: null,
    ...over,
  };
}

/** Dia COMPLETO da autoridade única de saldos; o teste sobrescreve o que importa. */
function authorityDay(
  civilDate: string,
  over: Partial<TreasuryDailyBalanceAuthorityDay> = {}
): TreasuryDailyBalanceAuthorityDay {
  return {
    civilDate,
    kind: "TODAY",
    expectedAccounts: [],
    openingCoverage: fullCoverage(),
    closingCoverage: fullCoverage(),
    previousEffectiveClosing: null,
    opening: 0,
    openingSource: "PREVIOUS_CLOSING",
    openingManual: null,
    openingAdjustment: null,
    inflows: 0,
    outflows: 0,
    predictedInflows: 0,
    predictedOutflows: 0,
    closingCalculated: 0,
    closingRealized: 0,
    closingInformed: null,
    closingSource: "CALCULATED",
    closingEffective: 0,
    divergence: null,
    divergenceBaseline: "REALIZED",
    warnings: [],
    ...over,
  };
}

/** Flow legado de hoje (`/today/closing`) — usado só para provar que perdeu a prioridade. */
function legacyTodayFlow(
  over: Partial<TreasuryCaixaDayFlow> = {}
): TreasuryCaixaDayFlow {
  return {
    civilDate: TODAY,
    opening: 0,
    inflows: 0,
    outflows: 0,
    closingCalculated: 0,
    closingInformed: null,
    divergence: null,
    accountCount: 1,
    pendingClosingCount: 0,
    ...over,
  };
}

/** Dia realizado com os campos de saldo zerados — o teste sobrescreve o que importa. */
function realizedDay(
  civilDate: string,
  over: Partial<TreasuryCaixaRealizedDay> = {}
): TreasuryCaixaRealizedDay {
  return {
    civilDate,
    inflows: 0,
    outflows: 0,
    receivableCount: 0,
    payableCount: 0,
    opening: null,
    closing: null,
    closingCalculated: null,
    closingInformed: null,
    divergence: null,
    ...over,
  };
}

/** Linha da linha do tempo; a zona sai da data contra {@link TODAY}. */
function row(
  civilDate: string,
  over: Partial<TreasuryCaixaTimelineRow> = {}
): TreasuryCaixaTimelineRow {
  const closing = over.closing !== undefined ? over.closing : 0;
  return {
    civilDate,
    kind:
      civilDate < TODAY ? "REALIZED" : civilDate > TODAY ? "FORECAST" : "TODAY",
    opening: 0,
    inflows: 0,
    outflows: 0,
    closing,
    closingCalculated: closing,
    closingInformed: null,
    divergence: null,
    negative: closing != null && closing < 0,
    ...over,
  };
}

const VK: TreasuryConsolidatedAccountRef = {
  accountId: "acc-vk",
  accountName: "Viacredi - Koppetel",
  companyCode: "KOPPETEL",
};
const VL: TreasuryConsolidatedAccountRef = {
  accountId: "acc-vl",
  accountName: "Viacredi - Lazarios",
  companyCode: "LAZARIOS",
};

// ── Linha TODAY vem da autoridade única (todayBalance) ─────────────────────

describe("treasuryCaixaRules — buildTreasuryCaixaUnifiedTimeline usa todayBalance (autoridade única)", () => {
  it("1) monta a linha TODAY inteiramente a partir do todayBalance passado", () => {
    const todayBalance = authorityDay(TODAY, {
      opening: 32060.64,
      inflows: 5000,
      outflows: 2000,
      predictedInflows: 1500,
      predictedOutflows: 800,
      closingRealized: 35060.64, // 32060,64 + 5000 - 2000
      closingCalculated: 35760.64, // 35060,64 + 1500 - 800
      closingInformed: null,
      closingEffective: 35760.64,
      divergence: null,
      divergenceBaseline: "REALIZED",
      openingCoverage: fullCoverage({ accountsExpected: 2, accountsCovered: 2 }),
      closingCoverage: fullCoverage({
        accountsExpected: 2,
        accountsCovered: 0,
        complete: false,
        partialSum: null,
      }),
      warnings: [],
    });

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      todayBalance,
      forecastDays: [],
    });

    const todayRow = timeline.rows.find((r) => r.kind === "TODAY");
    assert.ok(
      todayRow,
      "a linha TODAY precisa existir quando só todayBalance é passado (hoje sem todayFlow)"
    );
    assert.equal(todayRow!.opening, todayBalance.opening);
    assert.equal(todayRow!.closing, todayBalance.closingEffective);
    assert.equal(todayRow!.closingCalculated, todayBalance.closingCalculated);
    assert.equal(todayRow!.closingInformed, todayBalance.closingInformed);
    assert.equal(todayRow!.divergence, todayBalance.divergence);
    assert.equal(todayRow!.closingRealized, todayBalance.closingRealized);
    assert.equal(todayRow!.divergenceBaseline, todayBalance.divergenceBaseline);
    assert.deepEqual(todayRow!.openingCoverage, todayBalance.openingCoverage);
    assert.deepEqual(todayRow!.closingCoverage, todayBalance.closingCoverage);
  });

  it("2) inflows/outflows da linha TODAY somam realizado + previsto do todayBalance", () => {
    const todayBalance = authorityDay(TODAY, {
      inflows: 1000,
      outflows: 400,
      predictedInflows: 250,
      predictedOutflows: 90,
    });

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: null,
      todayBalance,
      forecastDays: [],
    });

    const todayRow = timeline.rows.find((r) => r.kind === "TODAY");
    assert.ok(todayRow, "a linha TODAY precisa existir");
    assert.equal(todayRow!.inflows, 1250); // 1000 realizado + 250 previsto
    assert.equal(todayRow!.outflows, 490); // 400 realizado + 90 previsto
  });

  it("3) RC5 — com todayBalance E todayFlow presentes (valores diferentes de opening), o todayBalance manda", () => {
    // Reprodução do defeito real: card "Caixa hoje" (todayBalance) mostrava
    // R$ 402.595,08 enquanto a linha "Começou" de hoje (todayFlow legado)
    // mostrava R$ 32.060,64 — a mesma autoridade tem que responder as duas.
    const todayBalance = authorityDay(TODAY, {
      opening: 402595.08,
      closingCalculated: 402595.08,
      closingRealized: 402595.08,
      closingEffective: 402595.08,
    });
    const legacyFlow = legacyTodayFlow({
      opening: 32060.64,
      closingCalculated: 32060.64,
    });

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayFlow: legacyFlow,
      todayBalance,
      forecastDays: [],
    });

    const todayRow = timeline.rows.find((r) => r.kind === "TODAY");
    assert.ok(todayRow, "a linha TODAY precisa existir");
    assert.equal(
      todayRow!.opening,
      402595.08,
      "todayBalance precisa mandar sobre o todayFlow legado"
    );
    assert.notEqual(
      todayRow!.opening,
      32060.64,
      "o valor do todayFlow legado não pode vazar quando todayBalance está presente"
    );
  });
});

// ── Proveniência/cobertura propagadas nas linhas REALIZED ───────────────────

describe("treasuryCaixaRules — buildTreasuryCaixaUnifiedTimeline propaga proveniência nas linhas REALIZED", () => {
  it("4) row REALIZED copia openingCoverage/closingCoverage/openingSource/closingSource/openingAdjustment/divergenceBaseline", () => {
    const openingCov = fullCoverage({ accountsExpected: 2, accountsCovered: 2 });
    const closingCov = fullCoverage({ accountsExpected: 2, accountsCovered: 2 });
    const rd = realizedDay("2026-08-01", {
      opening: 1000,
      inflows: 100,
      outflows: 50,
      closing: 1050,
      closingCalculated: 1050,
      openingCoverage: openingCov,
      closingCoverage: closingCov,
      openingSource: "MANUAL_OPENING",
      closingSource: "MANUAL_CLOSING",
      openingAdjustment: 500,
      divergenceBaseline: "CALCULATED",
    });

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [rd],
      todayFlow: null,
      todayBalance: null,
      forecastDays: [],
    });

    const realizedRow = timeline.rows.find((r) => r.civilDate === "2026-08-01");
    assert.ok(realizedRow, "a linha REALIZED precisa existir");
    assert.equal(realizedRow!.openingSource, "MANUAL_OPENING");
    assert.equal(realizedRow!.closingSource, "MANUAL_CLOSING");
    assert.equal(realizedRow!.openingAdjustment, 500);
    assert.equal(realizedRow!.divergenceBaseline, "CALCULATED");
    assert.deepEqual(realizedRow!.openingCoverage, openingCov);
    assert.deepEqual(realizedRow!.closingCoverage, closingCov);
  });

  it("5) row REALIZED preserva closingCalculated do realizedDay intacto (identidade 100+50-20=130)", () => {
    const rd = realizedDay("2026-08-02", {
      opening: 100,
      inflows: 50,
      outflows: 20,
      closing: 130,
      closingCalculated: 130,
    });

    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [rd],
      todayFlow: null,
      todayBalance: null,
      forecastDays: [],
    });

    const realizedRow = timeline.rows.find((r) => r.civilDate === "2026-08-02");
    assert.ok(realizedRow, "a linha REALIZED precisa existir");
    // O valor já vem pronto do realizedDay — não é recalculado aqui.
    assert.equal(realizedRow!.closingCalculated, 130);
  });
});

// ── buildTreasuryCaixaMonthlyTimeline: openingAdjustment e cobertura ────────

describe("treasuryCaixaRules — buildTreasuryCaixaMonthlyTimeline (openingAdjustment e cobertura)", () => {
  it("6) soma openingAdjustment dos dias do mês, tratando ausente como 0", () => {
    const rows = [
      row("2026-03-01", { openingAdjustment: undefined }),
      row("2026-03-02", { openingAdjustment: 200 }),
      row("2026-03-03", { openingAdjustment: null }),
    ];
    const months = buildTreasuryCaixaMonthlyTimeline(rows);
    assert.equal(months.length, 1);
    assert.equal(months[0]!.openingAdjustment, 200);
  });

  it("7) continuidade entre meses: mês N abre no fechamento do mês N-1 quando nenhum dia de N tem openingAdjustment", () => {
    const rows = [
      row("2026-03-01", { opening: 1000, closing: 1000 }),
      row("2026-03-02", { opening: 1000, closing: 1200 }),
      row("2026-04-01", { opening: 1200, closing: 1200 }),
      row("2026-04-02", { opening: 1200, closing: 1500 }),
    ];
    const months = buildTreasuryCaixaMonthlyTimeline(rows);
    assert.equal(months.length, 2);
    assert.equal(months[0]!.closing, 1200);
    assert.equal(months[1]!.opening, 1200);
    assert.equal(months[1]!.opening, months[0]!.closing);
  });

  it("8) coverageIncompleteDayCount conta só dias com closingCoverage incompleta e accountsExpected > 0", () => {
    const incomplete = fullCoverage({
      accountsExpected: 3,
      accountsCovered: 2,
      complete: false,
    });
    const complete = fullCoverage({
      accountsExpected: 3,
      accountsCovered: 3,
      complete: true,
    });

    const rows = [
      row("2026-05-01", { closingCoverage: incomplete }),
      row("2026-05-02", { closingCoverage: complete }),
      row("2026-05-03", { closingCoverage: complete }),
    ];
    const months = buildTreasuryCaixaMonthlyTimeline(rows);
    assert.equal(months[0]!.coverageIncompleteDayCount, 1);

    // Dia sem conta esperada (accountsExpected: 0) não conta como incompleto
    // — não há o que cobrir.
    const noAccountsExpected = fullCoverage({
      accountsExpected: 0,
      accountsCovered: 0,
      complete: false,
    });
    const rowsNoAccounts = [
      row("2026-06-01", { closingCoverage: noAccountsExpected }),
      row("2026-06-02", { closingCoverage: complete }),
    ];
    const monthsNoAccounts = buildTreasuryCaixaMonthlyTimeline(rowsNoAccounts);
    assert.equal(monthsNoAccounts[0]!.coverageIncompleteDayCount, 0);
  });
});

// ── emptyTreasuryBalanceCoverage ────────────────────────────────────────────

describe("treasuryDailyBalanceAuthority — emptyTreasuryBalanceCoverage", () => {
  it("9) devolve cobertura vazia com as contas esperadas como pendentes", () => {
    const result = emptyTreasuryBalanceCoverage([VK, VL]);
    assert.equal(result.accountsExpected, 2);
    assert.equal(result.accountsCovered, 0);
    assert.equal(result.complete, false);
    assert.deepEqual(result.pendingAccounts, [VK, VL]);
    assert.equal(result.partialSum, null);
  });
});
