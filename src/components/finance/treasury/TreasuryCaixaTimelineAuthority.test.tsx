/**
 * Marcadores visuais de cobertura/proveniência na Linha do tempo do Caixa.
 *
 * A célula mostra o VALOR. O detalhe de auditoria (manual, ajuste, cobertura
 * incompleta, realizado de hoje) vive no tooltip/popover do ícone — sempre
 * no DOM (CSS hover/foco), para SSR, acessibilidade e estes testes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreasuryCaixaTimeline } from "./TreasuryCaixaTimeline.js";
import type {
  TreasuryCaixaTimeline as TreasuryCaixaTimelineData,
  TreasuryCaixaTimelineRow,
} from "../../../lib/treasury/domain/treasuryCaixaRules.js";

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

function closeTagIndex(html: string, tagStart: number, attrAt: number): number {
  const afterLt = html.slice(tagStart + 1);
  const tag = afterLt.split(/[\s>]/, 1)[0];
  const openEnd = html.indexOf(">", attrAt);
  const openTok = `<${tag}`;
  const closeTok = `</${tag}>`;
  let depth = 1;
  let i = openEnd + 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(openTok, i);
    const nextClose = html.indexOf(closeTok, i);
    if (nextClose < 0) break;
    const openIsTag =
      nextOpen >= 0 &&
      nextOpen < nextClose &&
      /[\s>/]/.test(html[nextOpen + openTok.length] ?? "");
    if (openIsTag) {
      depth += 1;
      i = nextOpen + openTok.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose + closeTok.length;
    i = nextClose + closeTok.length;
  }
  assert.fail("não fechou o elemento");
  return html.length;
}

function innerHtmlOf(html: string, testId: string): string {
  const attr = `data-testid="${testId}"`;
  const attrAt = html.indexOf(attr);
  assert.ok(attrAt >= 0, `esperava o marcador ${testId}`);
  const tagStart = html.lastIndexOf("<", attrAt);
  const openEnd = html.indexOf(">", attrAt);
  const tag = html.slice(tagStart + 1).split(/[\s>]/, 1)[0];
  const closeEnd = closeTagIndex(html, tagStart, attrAt);
  return html.slice(openEnd + 1, closeEnd - `</${tag}>`.length);
}

function panelOf(html: string, testId: string): string {
  return innerHtmlOf(html, `${testId}-panel`);
}

/** Texto visível da tabela, sem tooltips e sem atributos (aria-label/title). */
function surfaceText(html: string): string {
  let out = html;
  while (out.includes('role="tooltip"')) {
    const attrAt = out.indexOf('role="tooltip"');
    const tagStart = out.lastIndexOf("<", attrAt);
    const closeEnd = closeTagIndex(out, tagStart, attrAt);
    out = out.slice(0, tagStart) + out.slice(closeEnd);
  }
  return out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("TreasuryCaixaTimeline — marcadores de cobertura/proveniência", () => {
  it("1) cobertura de FECHAMENTO parcial (2/3) fica no tooltip, não na superfície da célula", () => {
    const row = baseRow({
      closing: 103000,
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
      "esperava ícone de cobertura parcial de fechamento"
    );
    const panel = panelOf(html, "caixa-timeline-coverage-partial");
    assert.match(panel, /2 de 3/, "esperava contagem 2 de 3 no tooltip");
    assert.match(panel, /Sisprime - Koppetel/, "esperava o nome da conta pendente no tooltip");
    assert.match(
      panel,
      /n[ãa]o foi usado/i,
      "esperava a frase avisando que o subtotal parcial não foi usado como âncora"
    );
    assert.match(html, /aria-label="Fechamento incompleto: 2\/3 contas"/);
    assert.match(html, /R\$\s*103\.000,00/, "o valor de Terminou continua na célula");
    assert.doesNotMatch(
      surfaceText(html),
      /2\/3|2 de 3/,
      "2/3 não deve aparecer como texto visível da célula — só no tooltip"
    );
  });

  it("2) fechamento MANUAL com cobertura completa (3/3) descreve cobertura no tooltip", () => {
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
      "esperava ícone de fechamento manual completo"
    );
    const panel = panelOf(html, "caixa-timeline-closing-manual");
    assert.match(panel, /Saldo informado manualmente/);
    assert.match(panel, /Cobertura: 3 de 3 contas/);
    assert.match(html, /aria-label="[^"]*manualmente[^"]*3\/3/);
  });

  it("3) abertura MANUAL mostra proveniência no tooltip do ícone info", () => {
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
      "esperava ícone de abertura manual"
    );
    assert.match(panelOf(html, "caixa-timeline-opening-manual"), /Saldo informado manualmente/);
  });

  it("4) openingAdjustment != 0 mostra o valor do ajuste só no tooltip", () => {
    const row = baseRow({
      opening: 402595.08,
      openingSource: "MANUAL_OPENING",
      openingAdjustment: 15000.5,
    });
    const html = renderTimeline(row);

    assert.match(
      html,
      /data-testid="caixa-timeline-opening-adjustment"/,
      "esperava ícone de ajuste de abertura"
    );
    const panel = panelOf(html, "caixa-timeline-opening-adjustment");
    assert.match(
      panel,
      /15[.,]000[.,]50/,
      "esperava o valor do ajuste (15.000,50) no tooltip"
    );
    assert.match(panel, /ajustou a continuidade/);
    assert.doesNotMatch(
      surfaceText(html),
      /15[.,]000[.,]50/,
      "o valor do ajuste não deve ocupar a célula ao lado do saldo"
    );
  });

  it("5) linha de HOJE com closingRealized != closingCalculated descreve os dois valores no tooltip", () => {
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
      "esperava ícone do fechamento só-realizado de HOJE"
    );
    const panel = panelOf(html, "caixa-timeline-today-realized");
    assert.match(panel, /Saldo realizado agora/);
    assert.match(panel, /103[.,]000/);
    assert.match(panel, /Fechamento previsto/);
    assert.match(panel, /108[.,]000/);
    assert.match(
      html,
      /title="[^"]*realizado[^"]*"/i,
      "esperava que o title/tooltip da célula de divergência declarasse o baseline 'realizado'"
    );
    assert.doesNotMatch(
      surfaceText(html),
      /103[.,]000/,
      "REALIZADO AGORA não deve repetir o valor na superfície da célula"
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

  it("7) 02/09: Começou mostra só o valor; MANUAL e ajuste ficam nos ícones", () => {
    const row = baseRow({
      civilDate: "2026-09-02",
      opening: 402595.08,
      openingSource: "MANUAL_OPENING",
      openingAdjustment: 370534.44,
      openingCoverage: {
        accountsExpected: 3,
        accountsCovered: 3,
        complete: true,
        accounts: [],
        pendingAccounts: [],
        partialSum: null,
      },
    });
    const html = renderTimeline(row);
    assert.match(html, /R\$\s*402\.595,08/);
    assert.match(
      panelOf(html, "caixa-timeline-opening-manual"),
      /Cobertura: 3 de 3 contas/
    );
    assert.match(
      panelOf(html, "caixa-timeline-opening-adjustment"),
      /370[.,]534[.,]44/
    );
    assert.doesNotMatch(surfaceText(html), /MANUAL/);
    assert.doesNotMatch(surfaceText(html), /370[.,]534[.,]44/);
  });

  it("8) 03/09: Terminou mostra o previsto; 0/3 e realizado agora ficam no tooltip", () => {
    const row = baseRow({
      civilDate: "2026-09-03",
      kind: "TODAY",
      opening: 402595.08,
      closing: 377612.24,
      closingCalculated: 377612.24,
      closingRealized: 402595.08,
      closingCoverage: {
        accountsExpected: 3,
        accountsCovered: 0,
        complete: false,
        accounts: [],
        pendingAccounts: [
          { accountId: "a", accountName: "Banco A", companyCode: "KOPPETEL" },
          { accountId: "b", accountName: "Banco B", companyCode: "KOPPETEL" },
          { accountId: "c", accountName: "Banco C", companyCode: "KOPPETEL" },
        ],
        partialSum: null,
      },
      divergenceBaseline: "REALIZED",
    });
    const html = renderTimeline(row);
    assert.match(html, /R\$\s*402\.595,08/);
    assert.match(html, /R\$\s*377\.612,24/);
    const coveragePanel = panelOf(html, "caixa-timeline-coverage-partial");
    assert.match(coveragePanel, /0 de 3/);
    assert.match(coveragePanel, /n[ãa]o foi usado/i);
    const realizedPanel = panelOf(html, "caixa-timeline-today-realized");
    assert.match(realizedPanel, /Saldo realizado agora/);
    assert.match(realizedPanel, /402[.,]595[.,]08/);
    assert.match(realizedPanel, /Fechamento previsto/);
    assert.match(realizedPanel, /377[.,]612[.,]24/);
    assert.doesNotMatch(surfaceText(html), /0\/3|0 de 3/);
    assert.doesNotMatch(surfaceText(html), /REALIZADO AGORA/i);
  });

  it("9) o ícone tem aria-label e title — a informação não depende só da cor", () => {
    const row = baseRow({
      openingSource: "MANUAL_OPENING",
      openingAdjustment: 1,
      closingSource: "MANUAL_CLOSING",
      closingCoverage: {
        accountsExpected: 1,
        accountsCovered: 1,
        complete: true,
        accounts: [],
        pendingAccounts: [],
        partialSum: null,
      },
    });
    const html = renderTimeline(row);
    assert.match(html, /aria-label="Saldo informado manualmente/);
    assert.match(html, /title="Saldo informado manualmente/);
    assert.match(html, /aria-label="Ajuste de abertura:/);
    assert.match(html, /title="Ajuste de abertura:/);
    assert.match(html, /role="tooltip"/);
  });

  it("10) o CSS do tooltip é carregado pela página do Caixa (hover/foco, sem JS)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = readFileSync(join(here, "TreasuryCaixaPage.tsx"), "utf8");
    const css = readFileSync(join(here, "treasury-caixa-timeline.css"), "utf8");
    assert.match(page, /treasury-caixa-timeline\.css/);
    assert.match(css, /\.caixa-timeline-note:hover \.caixa-timeline-note-panel/);
    assert.match(css, /\.caixa-timeline-note:focus-within \.caixa-timeline-note-panel/);
    assert.match(css, /display:\s*none/);
  });
});
