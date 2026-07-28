import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryGuidedTodayDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_TODAY_DENIED_MESSAGE,
  TREASURY_TODAY_EMPTY_TITLE,
  TREASURY_TODAY_PAGE_TITLE,
} from "@/src/lib/treasury/treasuryTodayUi.js";
import { TreasuryTodayPanel } from "./TreasuryTodayPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleToday(): TreasuryGuidedTodayDto {
  return {
    ok: true,
    civilDate: "2026-07-28",
    asOf: "2026-07-28T12:00:00.000-03:00",
    title: TREASURY_TODAY_PAGE_TITLE,
    empty: false,
    consolidated: {
      openingBalance: "1000.00",
      plannedInflows: "200.00",
      realizedInflows: "50.00",
      plannedOutflows: "80.00",
      realizedOutflows: "20.00",
      predictedClosingBalance: "1120.00",
      realizedClosingBalance: "1030.00",
      informedClosingBalance: "1100.00",
      divergence: "70.00",
    },
    steps: [
      {
        id: "OPENING_BALANCES",
        order: 1,
        title: "Informar saldos iniciais",
        status: "DONE",
        continueHref: "/finance/treasury/today/opening",
        continueLabel: "Continuar",
      },
      {
        id: "REVIEW_RECEIPTS",
        order: 2,
        title: "Revisar recebimentos",
        status: "NEEDS_ATTENTION",
        continueHref: "/finance/treasury/today/receivables",
        continueLabel: "Continuar",
      },
      {
        id: "REVIEW_PAYMENTS",
        order: 3,
        title: "Revisar pagamentos",
        status: "PENDING",
        continueHref: "/finance/treasury/today/payables",
        continueLabel: "Continuar",
      },
      {
        id: "CLOSING_BALANCES",
        order: 4,
        title: "Informar saldos finais",
        status: "PENDING",
        continueHref: "/finance/treasury/today/closing",
        continueLabel: "Continuar",
      },
      {
        id: "RESOLVE_DIVERGENCES",
        order: 5,
        title: "Resolver divergências",
        status: "PENDING",
        continueHref: "/finance/treasury/today/closing?step=divergences",
        continueLabel: "Continuar",
      },
      {
        id: "CLOSE_DAY",
        order: 6,
        title: "Fechar o dia",
        status: "PENDING",
        continueHref: "/finance/treasury/today/closing?step=close",
        continueLabel: "Continuar",
      },
    ],
    accounts: [
      {
        accountId: "acc-1",
        name: "Caixa Matriz",
        bank: "Itaú",
        openingBalance: "1000.00",
        predictedClosingBalance: "1120.00",
        realizedClosingBalance: "1030.00",
        informedClosingBalance: null,
        divergence: null,
        status: "OPEN",
        openHref: "/finance/treasury/accounts/acc-1/balances",
      },
    ],
    attention: [
      {
        id: "pending-receipts",
        code: "PENDING_RECEIPT",
        message: "1 recebimento(s) previsto(s) ainda não baixado(s).",
        amount: "150.00",
        accountId: null,
        href: "/finance/treasury/today/receivables",
      },
    ],
  };
}

function renderPanel(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasuryTodayPage — painel e estados", () => {
  it("exibe estado sem permissão", () => {
    const html = renderPanel(
      <TreasuryTodayPanel
        viewKind="denied"
        data={null}
        error={null}
        onRefresh={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_TODAY_DENIED_MESSAGE));
    assert.match(html, /treasury-today-denied/);
  });

  it("exibe carregamento", () => {
    const html = renderPanel(
      <TreasuryTodayPanel
        viewKind="loading"
        data={null}
        error={null}
        onRefresh={noop}
      />
    );
    assert.match(html, /treasury-today-loading/);
  });

  it("exibe erro com retry", () => {
    const html = renderPanel(
      <TreasuryTodayPanel
        viewKind="error"
        data={null}
        error="Falha de rede"
        onRefresh={noop}
      />
    );
    assert.match(html, /treasury-today-error/);
    assert.match(html, /Falha de rede/);
  });

  it("exibe vazio", () => {
    const html = renderPanel(
      <TreasuryTodayPanel
        viewKind="empty"
        data={{ ...sampleToday(), empty: true, accounts: [], attention: [] }}
        error={null}
        onRefresh={noop}
      />
    );
    assert.match(html, new RegExp(TREASURY_TODAY_EMPTY_TITLE));
  });

  it("exibe cards, rotina, contas, pendências e status textual", () => {
    const html = renderPanel(
      <TreasuryTodayPanel
        viewKind="ready"
        data={sampleToday()}
        error={null}
        onRefresh={noop}
      />
    );
    assert.match(html, /Tesouraria de hoje/);
    assert.match(html, /28\/07\/2026/);
    assert.match(html, /treasury-today-metric-opening/);
    assert.match(html, /Saldo inicial/);
    assert.match(html, /Entradas previstas/);
    assert.match(html, /Divergência total/);
    assert.match(html, /Status: Concluída/);
    assert.match(html, /Status: Precisa de atenção/);
    assert.match(html, /Status: Pendente/);
    assert.match(html, /Caixa Matriz/);
    assert.match(html, /Abrir conta/);
    assert.match(html, /recebimento\(s\) previsto/);
    assert.doesNotMatch(html, /overlay|ledger|allocation|snapshot/i);
  });

  it("página e módulo apontam para a experiência guiada", () => {
    const page = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryTodayPage.tsx"),
      "utf8"
    );
    const mod = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryModule.tsx"),
      "utf8"
    );
    assert.match(page, /fetchTreasuryToday/);
    assert.match(mod, /TreasuryTodayPage/);
    assert.match(mod, /path="today"/);
    assert.match(mod, /path="dashboard"/);
  });
});
