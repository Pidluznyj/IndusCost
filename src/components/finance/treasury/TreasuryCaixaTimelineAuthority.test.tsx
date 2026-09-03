/**
 * RED (TDD) — marcadores visuais de COBERTURA/PROVENIÊNCIA na Linha do tempo
 * do Caixa (`TreasuryCaixaTimeline`).
 *
 * Missão 03/09/2026 (ver `treasuryDailyBalanceAuthority.ts`): quando só
 * ALGUMAS contas do consolidado informaram o saldo do dia, a tela precisa
 * SINALIZAR isso — nunca prometer que um subtotal parcial virou o saldo
 * oficial. Este arquivo documenta o comportamento visual esperado através de
 * `data-testid`s que AINDA NÃO EXISTEM em `TreasuryCaixaTimeline.tsx` — os
 * testes abaixo devem falhar por AUSÊNCIA do elemento/texto, não por erro de
 * import/tipo. É o ponto de partida para a implementação (fase GREEN).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreasuryCaixaTimeline } from "./TreasuryCaixaTimeline.js";
import type {
  TreasuryCaixaTimeline as TreasuryCaixaTimelineData,
  TreasuryCaixaTimelineRow,
} from "../../../lib/treasury/domain/treasuryCaixaRules.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Linha base "limpa" (dia realizado comum) — cada teste sobrescreve o que precisa. */
function baseRow(overrides: Partial<TreasuryCaixaTimelineRow> = {}): TreasuryCaixaTimelineRow {
  return {
    civilDate: "2026-08-15",
    kind: "REALIZED",
    opening: 100000,
    inflows: 5000,
    outflows: 2000,
    closing: 103000,
    closingCalculated: 103000,
    closingInformed: null,
    divergence: null,
    negative: false,
    ...overrides,
  };
}

/**
 * Timeline com UM único dia — dentro de um único mês, então o componente
 * entra direto em modo "day" (useState inicial já é "day"; SSR não roda o
 * useEffect que reagruparia por mês quando o período tem mais de um mês).
 */
function timelineWithRow(row: TreasuryCaixaTimelineRow): TreasuryCaixaTimelineData {
  return {
    todayCivilDate: "2026-08-20",
    rows: [row],
    realizedCount: 1,
    forecastCount: 0,
    firstNegativeDate: null,
  };
}

function renderTimeline(row: TreasuryCaixaTimelineRow): string {
  return renderToStaticMarkup(
    <TreasuryCaixaTimeline timeline={timelineWithRow(row)} />
  );
}

describe("TreasuryCaixaTimeline — marcadores de cobertura/proveniência (RED)", () => {
  it("1) cobertura de FECHAMENTO parcial (2/3) mostra subtotal não usado + conta pendente", () => {
    const row = baseRow({
      closingCoverage: {
        accountsExpected: 3,
        accountsCovered: 2,
        complete: false,
        accounts: [
          {
            accountId: "acc-1",
            accountName: "Banco A",
            companyCode: "KOPPETEL",
            source: "MANUAL_CLOSING",
            amount: 60000,
            informedAt: "2026-08-15T18:00:00.000Z",
            referenceDate: "2026-08-15",
          },
          {
            accountId: "acc-2",
            accountName: "Banco B",
            companyCode: "KOPPETEL",
            source: "FORMAL_CLOSING",
            amount: 67543.33,
            informedAt: "2026-08-15T18:05:00.000Z",
            referenceDate: "2026-08-15",
          },
        ],
        pendingAccounts: [
          { accountId: "acc-sk", accountName: "Sisprime - Koppetel", companyCode: "KOPPETEL" },
        ],
        partialSum: 127543.33,
      },
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-coverage-partial"/,
      "esperava marcador de cobertura parcial de fechamento — ainda não implementado"
    );
    assert.match(html, /2\/3/, "esperava contagem 2/3 de contas cobertas");
    assert.match(html, /Sisprime - Koppetel/, "esperava o nome da conta pendente");
    assert.match(
      html,
      /n[ãa]o foi usado/i,
      "esperava a frase avisando que o subtotal parcial não foi usado como âncora"
    );
  });

  it("2) fechamento MANUAL com cobertura completa (3/3) mostra marcador 'manual'", () => {
    const fullAccounts = [
      {
        accountId: "acc-1",
        accountName: "Banco A",
        companyCode: "KOPPETEL",
        source: "MANUAL_CLOSING" as const,
        amount: 80000,
        informedAt: "2026-08-15T18:00:00.000Z",
        referenceDate: "2026-08-15",
      },
      {
        accountId: "acc-2",
        accountName: "Banco B",
        companyCode: "KOPPETEL",
        source: "MANUAL_CLOSING" as const,
        amount: 90000,
        informedAt: "2026-08-15T18:05:00.000Z",
        referenceDate: "2026-08-15",
      },
      {
        accountId: "acc-3",
        accountName: "Banco C",
        companyCode: "KOPPETEL",
        source: "MANUAL_CLOSING" as const,
        amount: 80000,
        informedAt: "2026-08-15T18:10:00.000Z",
        referenceDate: "2026-08-15",
      },
    ];
    const row = baseRow({
      closingSource: "MANUAL_CLOSING",
      closingInformed: 250000,
      closing: 250000,
      closingCoverage: {
        accountsExpected: 3,
        accountsCovered: 3,
        complete: true,
        accounts: fullAccounts,
        pendingAccounts: [],
        partialSum: null,
      },
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-closing-manual"/,
      "esperava marcador de fechamento manual completo — ainda não implementado"
    );
    assert.match(html, /manual/i, "esperava a palavra 'manual' no marcador");
    assert.match(html, /3\/3/, "esperava contagem 3/3 de contas cobertas");
  });

  it("3) abertura MANUAL mostra marcador de proveniência", () => {
    const row = baseRow({
      openingSource: "MANUAL_OPENING",
      openingCoverage: {
        accountsExpected: 1,
        accountsCovered: 1,
        complete: true,
        accounts: [
          {
            accountId: "acc-1",
            accountName: "Banco A",
            companyCode: "KOPPETEL",
            source: "MANUAL_OPENING",
            amount: 100000,
            informedAt: "2026-08-15T08:00:00.000Z",
            referenceDate: "2026-08-15",
          },
        ],
        pendingAccounts: [],
        partialSum: null,
      },
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-opening-manual"/,
      "esperava marcador de abertura manual — ainda não implementado"
    );
  });

  it("4) openingAdjustment != 0 mostra o valor do ajuste formatado", () => {
    const row = baseRow({
      openingSource: "MANUAL_OPENING",
      openingAdjustment: 15000.5,
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-opening-adjustment"/,
      "esperava marcador de ajuste de abertura — ainda não implementado"
    );
    assert.match(
      html,
      /15[.,]000[.,]50/,
      "esperava o valor do ajuste (15.000,50) formatado em algum separador razoável"
    );
  });

  it("5) linha de HOJE com closingRealized != closingCalculated mostra marcador e baseline 'realizado' no tooltip da divergência", () => {
    const row = baseRow({
      civilDate: "2026-08-20",
      kind: "TODAY",
      closingCalculated: 108000,
      closingRealized: 103000,
      closingInformed: 105000,
      closing: 105000,
      divergence: 2000,
      divergenceBaseline: "REALIZED",
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-today-realized"/,
      "esperava marcador do fechamento só-realizado de HOJE — ainda não implementado"
    );
    assert.match(
      html,
      /title="[^"]*realizado[^"]*"/i,
      "esperava que o title/tooltip da célula de divergência declarasse o baseline 'realizado'"
    );
  });

  it("6) sem contas esperadas no dia (accountsExpected === 0), a linha fica limpa — nenhum marcador de cobertura", () => {
    const row = baseRow({
      closingCoverage: {
        accountsExpected: 0,
        accountsCovered: 0,
        complete: false,
        accounts: [],
        pendingAccounts: [],
        partialSum: null,
      },
    });
    const html = renderTimeline(row);

    assert.doesNotMatch(html, /data-testid="caixa-timeline-coverage-partial"/);
    assert.doesNotMatch(html, /data-testid="caixa-timeline-closing-manual"/);
    assert.doesNotMatch(html, /data-testid="caixa-timeline-opening-manual"/);
    assert.doesNotMatch(html, /data-testid="caixa-timeline-opening-adjustment"/);
    assert.doesNotMatch(html, /data-testid="caixa-timeline-today-realized"/);
  });
});
