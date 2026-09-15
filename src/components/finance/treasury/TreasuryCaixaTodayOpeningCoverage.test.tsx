/**
 * Caixa — saldo inicial de HOJE informado por só parte das contas (caso real
 * dos prints de 15/09/2026).
 *
 * Regra mantida (missão 03/09/2026): o "Começou" de hoje só usa o saldo
 * inicial informado com TODAS as contas esperadas; senão segue o fechamento do
 * dia anterior. O que muda: a linha do tempo e o "Movimento de hoje" avisam a
 * abertura incompleta (quais contas faltam, subtotal não usado) e o card mostra
 * os MESMOS saldos da linha HOJE — antes ele mostrava o subtotal parcial.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveTreasuryDailyBalanceAuthority,
  type TreasuryConsolidatedAccountMembershipView,
  type TreasuryDailyBalanceAuthorityDay,
  type TreasuryManualBalanceEvidenceInput,
} from "@/src/lib/treasury/domain/treasuryDailyBalanceAuthority.js";
import {
  alignTreasuryCaixaTodayFlowWithBalanceAuthority,
  applyTreasuryCaixaCanonicalTodayFlow,
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaUnifiedTimeline,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import type { TreasuryCaixaCanonicalDay } from "@/src/lib/treasury/domain/treasuryCaixaCanonicalDay.js";
import { TreasuryCaixaTimeline } from "./TreasuryCaixaTimeline.js";
import { TreasuryCaixaTodayFlow } from "./TreasuryCaixaTodayFlow.js";

const TODAY = "2026-09-15";
const YESTERDAY = "2026-09-14";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "TreasuryCaixaPage.tsx"), "utf8").replace(/\r\n/g, "\n");

function account(id: string, name: string, validUntil: string | null = null): TreasuryConsolidatedAccountMembershipView {
  return {
    accountId: id,
    accountName: name,
    companyCode: "KOPPETEL",
    memberships: [{ validFrom: "2026-01-01", validUntil }],
    membershipSource: "TABLE",
  };
}

function evidence(accountId: string, civilDate: string, amount: number): TreasuryManualBalanceEvidenceInput {
  return { accountId, civilDate, amount, informedAt: `${civilDate}T13:00:00.000Z`, version: 1 };
}

const ACCOUNTS = [
  account("vk", "Viacredi - Koppetel"),
  account("vl", "Viacredi - Lazarios"),
  account("sk", "Sisprime - Koppetel"),
  // Desativada hoje: já não é esperada hoje (dia da saída).
  account("sl", "Sisprime - Lazarios", TODAY),
];

/** Previsão de hoje dos prints: R$ 29.598,48 a receber e R$ 33.527,87 a pagar. */
const PREDICTED = { inflows: 29598.48, outflows: 33527.87 };

function todayBalance(openingsToday: TreasuryManualBalanceEvidenceInput[]): TreasuryDailyBalanceAuthorityDay {
  const result = resolveTreasuryDailyBalanceAuthority({
    civilDates: [YESTERDAY, TODAY],
    genesisCivilDate: YESTERDAY,
    todayCivilDate: TODAY,
    accounts: ACCOUNTS,
    manualOpenings: openingsToday,
    // 14/09 fechado com as 4 contas: 14.676.755,00 (como na linha do tempo).
    manualClosings: [
      evidence("vk", YESTERDAY, 14555555),
      evidence("vl", YESTERDAY, 121200),
      evidence("sk", YESTERDAY, 0),
      evidence("sl", YESTERDAY, 0),
    ],
    genericSnapshots: [],
    formalClosings: [],
    flows: [],
    todayPredicted: PREDICTED,
  });
  return result.byCivilDate.get(TODAY)!;
}

/** Só Sisprime - Koppetel informou o saldo inicial de hoje (Movimento de hoje: 120.000). */
const PARTIAL = todayBalance([evidence("sk", TODAY, 120000)]);
const COMPLETE = todayBalance([evidence("vk", TODAY, 2222222), evidence("vl", TODAY, 121200), evidence("sk", TODAY, 120000)]);

const CANONICAL_TODAY = {
  civilDate: TODAY,
  receivableDue: PREDICTED.inflows,
  receivableReceived: 0,
  payableDue: PREDICTED.outflows,
  payablePaid: 0,
  receivableDueTitles: Array.from({ length: 7 }, () => ({})),
  receivableReceivedTitles: [],
  payableDueTitles: Array.from({ length: 17 }, () => ({})),
  payablePaidTitles: [],
} as unknown as TreasuryCaixaCanonicalDay;

/** Fluxo do `/today/closing` como a página monta: só a conta que informou tem abertura. */
function legacyTodayFlow() {
  const raw = buildTreasuryCaixaDayFlow({
    civilDate: TODAY,
    accounts: [
      { openingBalance: null, realizedInflows: 0, realizedOutflows: 0, realizedClosingBalance: null, informedClosingBalance: null },
      { openingBalance: null, realizedInflows: 0, realizedOutflows: 0, realizedClosingBalance: null, informedClosingBalance: null },
      { openingBalance: 120000, realizedInflows: 0, realizedOutflows: 0, realizedClosingBalance: 120000, informedClosingBalance: null },
    ],
  });
  return applyTreasuryCaixaCanonicalTodayFlow(raw, CANONICAL_TODAY, { fallbackOpening: 14676755 });
}

describe("Caixa — os números dos prints de 15/09/2026", () => {
  it("abertura 1 de 3: a linha HOJE segue 14/09 e o card antigo mostrava o subtotal", () => {
    assert.equal(PARTIAL.openingSource, "PREVIOUS_CLOSING");
    assert.equal(PARTIAL.opening, 14676755);
    assert.equal(PARTIAL.closingCalculated, 14672825.61, "Terminou da linha HOJE no print");
    assert.equal(PARTIAL.openingCoverage.accountsCovered, 1);
    assert.equal(PARTIAL.openingCoverage.accountsExpected, 3, "Sisprime - Lazarios, desativada hoje, não conta");
    assert.equal(PARTIAL.openingCoverage.partialSum, 120000);

    const legacy = legacyTodayFlow();
    assert.equal(legacy.opening, 120000, "Começou com do card no print");
    assert.equal(legacy.closingCalculated, 116070.61, "Terminou com (previsto) do card no print");
  });

  it("com as 3 contas ativas informadas, o Começou de hoje vira o saldo informado", () => {
    assert.equal(COMPLETE.openingSource, "MANUAL_OPENING");
    assert.equal(COMPLETE.opening, 2463422);
    assert.equal(COMPLETE.closingCalculated, 2459492.61);
  });
});

describe("Caixa — Movimento de hoje com os mesmos saldos da linha HOJE", () => {
  it("abertura, fechamentos e contas sem saldo final vêm da autoridade; entradas/saídas/previsão ficam", () => {
    const legacy = legacyTodayFlow();
    const aligned = alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacy, PARTIAL);
    assert.equal(aligned.opening, 14676755);
    assert.equal(aligned.closingCalculated, 14672825.61);
    assert.equal(aligned.closingInformed, null);
    assert.equal(aligned.pendingClosingCount, 3);
    assert.equal(aligned.inflows, legacy.inflows);
    assert.equal(aligned.outflows, legacy.outflows);
    assert.equal(aligned.predictedInflows, legacy.predictedInflows);
    assert.equal(aligned.predictedOutflows, legacy.predictedOutflows);

    // Mesmo Começou/Terminou da linha HOJE da linha do tempo.
    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayBalance: PARTIAL,
      todayFlow: aligned,
      forecastDays: [],
    });
    const todayRow = timeline.rows.find((r) => r.kind === "TODAY")!;
    assert.equal(todayRow.opening, aligned.opening);
    assert.equal(todayRow.closing, aligned.closingInformed ?? aligned.closingCalculated);
  });

  it("sem autoridade (board ainda não carregou) ou de outro dia, o fluxo fica como veio", () => {
    const legacy = legacyTodayFlow();
    assert.equal(alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacy, null), legacy);
    assert.equal(alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacy, undefined), legacy);
    assert.equal(
      alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacy, { ...PARTIAL, civilDate: YESTERDAY }),
      legacy
    );
  });

  it("o card avisa o saldo inicial incompleto e mostra o Começou da linha HOJE", () => {
    const html = renderToStaticMarkup(
      <TreasuryCaixaTodayFlow
        flow={alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacyTodayFlow(), PARTIAL)}
        canonicalToday={CANONICAL_TODAY}
        openingCoverage={PARTIAL.openingCoverage}
      />
    );
    assert.match(html, /data-testid="caixa-today-flow-opening-partial"/);
    assert.match(
      html,
      /Saldo inicial de hoje incompleto: 1 de 3 contas informaram \(faltam: Viacredi - Koppetel, Viacredi - Lazarios\)\. Enquanto não completar, o &quot;começou com&quot; segue o fechamento do dia anterior — o subtotal de R\$\s120\.000,00 não entra\./
    );
    assert.match(html, /Começou com<\/p><p[^>]*>R\$\s14\.676\.755,00</);
    assert.match(html, /Terminou com \(previsto\)<\/p><p[^>]*>R\$\s14\.672\.825,61</);
    assert.doesNotMatch(html, /R\$\s120\.000,00<\/p>/, "o subtotal não aparece como Começou com");
  });

  it("sem aviso com abertura completa, sem ninguém informando ou sem cobertura", () => {
    const render = (coverage: TreasuryDailyBalanceAuthorityDay["openingCoverage"] | null) =>
      renderToStaticMarkup(
        <TreasuryCaixaTodayFlow
          flow={alignTreasuryCaixaTodayFlowWithBalanceAuthority(legacyTodayFlow(), COMPLETE)}
          canonicalToday={CANONICAL_TODAY}
          openingCoverage={coverage}
        />
      );
    assert.doesNotMatch(render(COMPLETE.openingCoverage), /caixa-today-flow-opening-partial/);
    assert.match(render(COMPLETE.openingCoverage), /Começou com<\/p><p[^>]*>R\$\s2\.463\.422,00</);
    assert.doesNotMatch(render(todayBalance([]).openingCoverage), /caixa-today-flow-opening-partial/);
    assert.doesNotMatch(render(null), /caixa-today-flow-opening-partial/);
  });
});

describe("Caixa — linha do tempo marca a abertura incompleta no Começou", () => {
  function renderToday(balance: TreasuryDailyBalanceAuthorityDay): string {
    const timeline = buildTreasuryCaixaUnifiedTimeline({
      todayCivilDate: TODAY,
      realizedDays: [],
      todayBalance: balance,
      forecastDays: [],
    });
    return renderToStaticMarkup(<TreasuryCaixaTimeline timeline={timeline} />);
  }

  it("parcial: ícone com contas pendentes e subtotal não usado", () => {
    const html = renderToday(PARTIAL);
    assert.match(html, /data-testid="caixa-timeline-opening-coverage-partial"/);
    assert.match(html, /Abertura incompleta: 1\/3 contas/);
    assert.match(html, /Abertura incompleta: 1 de 3 contas informaram saldo\s+inicial\./);
    assert.match(html, /Pendente: Viacredi - Koppetel, Viacredi - Lazarios\./);
    assert.match(html, /Subtotal informado \(não usado\): R\$\s120\.000,00\./);
  });

  it("completa: marca de saldo manual, sem aviso de abertura incompleta", () => {
    const html = renderToday(COMPLETE);
    assert.doesNotMatch(html, /caixa-timeline-opening-coverage-partial/);
    assert.match(html, /data-testid="caixa-timeline-opening-manual"/);
  });

  it("ninguém informou o saldo inicial: seguir o fechamento anterior é o normal, sem aviso", () => {
    assert.doesNotMatch(renderToday(todayBalance([])), /caixa-timeline-opening-coverage-partial/);
  });
});

describe("Caixa — página liga o card à autoridade (gates do fonte)", () => {
  it("Movimento de hoje alinhado ao board, com a cobertura de abertura e esperando o caixa do período", () => {
    const memo = page.slice(page.indexOf("const correctedTodayFlow = useMemo("), page.indexOf("const timeline = useMemo"));
    assert.match(memo, /alignTreasuryCaixaTodayFlowWithBalanceAuthority\(\s*applyTreasuryCaixaCanonicalTodayFlow\(/);
    assert.match(memo, /data\?\.todayBalance\s*\)/);
    assert.match(memo, /\[todayFlow, canonicalToday, chainedOpeningForToday, data\]/);
    assert.match(page, /openingCoverage=\{data\?\.todayBalance\?\.openingCoverage \?\? null\}/);
    assert.match(page, /loading=\{todayFlowLoading \|\| \(loading && data == null\)\}/);
  });
});
