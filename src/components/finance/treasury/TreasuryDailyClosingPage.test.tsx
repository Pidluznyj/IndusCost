import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_DAILY_CLOSING_409_MESSAGE,
  TREASURY_DAILY_CLOSING_PAGE_TITLE,
} from "@/src/lib/treasury/treasuryDailyClosingUi.js";
import { TreasuryDailyClosingPanel } from "./TreasuryDailyClosingPanel.js";

const here = dirname(fileURLToPath(import.meta.url));

function noop() {}

function samplePreview(): TreasuryDailyClosingPreviewDto {
  return {
    ok: true,
    civilDate: "2026-07-27",
    companyCode: "EMP1",
    sourceHash: "c".repeat(64),
    generatedAt: "2026-07-27T18:00:00.000-03:00",
    summary: {
      openingBalance: "1000.00",
      realizedInflows: "200.00",
      realizedOutflows: "50.00",
      pendenciesAmount: "30.00",
      closingBalance: "1150.00",
      observedBalance: "1140.00",
      reconciledBalance: "1140.00",
      differenceAmount: "10.00",
      accountCount: 1,
      pendingReceivablesCount: 1,
      pendingPayablesCount: 0,
      absoluteBlockCount: 0,
      warningCount: 1,
      caveatRequiredCount: 1,
    },
    accounts: [
      {
        accountId: "acc-1",
        code: "CX01",
        name: "Caixa",
        openingBalance: "1000.00",
        realizedInflows: "200.00",
        realizedOutflows: "50.00",
        pendenciesAmount: "30.00",
        closingBalance: "1150.00",
        observedBalance: "1140.00",
        reconciledBalance: "1140.00",
        differenceAmount: "10.00",
        minimumBalance: "0.00",
        allowNegativeBalance: false,
        balanceStale: true,
        lastBalanceAt: "2026-07-20T12:00:00.000-03:00",
      },
    ],
    absoluteBlocks: [],
    warnings: [
      {
        code: "STALE_BALANCE",
        severity: "WARNING",
        title: "Saldo desatualizado",
        description: "CX01 com snapshot antigo.",
        amount: "1140.00",
        accountId: "acc-1",
        entityId: "acc-1",
        requiresCaveat: true,
        blocksClose: false,
      },
    ],
    pendingReceivables: [
      {
        side: "RECEIVABLE",
        officialTitleId: "ar-1",
        nomusExternalId: 11,
        counterpartyName: "Cliente Alfa",
        openAmount: "30.00",
        dueDate: "2026-07-27",
        expectedDate: "2026-07-27",
        accountId: "acc-1",
        dueOrExpectedOnOrBeforeCivilDate: true,
      },
    ],
    pendingPayables: [],
    unreconciledMovements: [],
    staleBalances: [],
    expiredPromises: [],
    transfersInTransit: [],
    canCloseWithoutCaveats: false,
    canCloseWithCaveats: true,
    requiredCaveatCodes: ["STALE_BALANCE"],
  };
}

function sampleHistory(): TreasuryDailyClosingDto[] {
  return [
    {
      id: "close-1",
      companyCode: "EMP1",
      civilDate: "2026-07-27",
      status: "CLOSED",
      version: 1,
      sourceHash: "c".repeat(64),
      contentHash: null,
      openingBalance: "1000.00",
      realizedInflows: "200.00",
      realizedOutflows: "50.00",
      pendenciesAmount: "30.00",
      closingBalance: "1150.00",
      observedBalance: "1140.00",
      reconciledBalance: "1140.00",
      differenceAmount: "10.00",
      exceptionsCount: 0,
      exceptionsAmount: "0.00",
      caveatsCount: 1,
      previousClosingId: null,
      supersededByClosingId: null,
      closedByUserId: "u1",
      closedAt: "2026-07-27T20:00:00.000-03:00",
      createdByUserId: "u1",
      createdAt: "2026-07-27T20:00:00.000-03:00",
    },
    {
      id: "close-2",
      companyCode: "EMP1",
      civilDate: "2026-07-27",
      status: "OPEN",
      version: 2,
      sourceHash: "d".repeat(64),
      contentHash: null,
      openingBalance: "1000.00",
      realizedInflows: "210.00",
      realizedOutflows: "50.00",
      pendenciesAmount: "20.00",
      closingBalance: "1160.00",
      observedBalance: "1160.00",
      reconciledBalance: "1160.00",
      differenceAmount: "0.00",
      exceptionsCount: 0,
      exceptionsAmount: "0.00",
      caveatsCount: 0,
      previousClosingId: "close-1",
      supersededByClosingId: null,
      closedByUserId: null,
      closedAt: null,
      createdByUserId: "u1",
      createdAt: "2026-07-27T21:00:00.000-03:00",
    },
  ];
}

const baseProps = {
  deniedMessage: "Sem permissão",
  error: null as string | null,
  conflictMessage: null as string | null,
  successMessage: null as string | null,
  civilDate: "2026-07-27",
  companyCode: "EMP1",
  notes: "",
  preview: null as TreasuryDailyClosingPreviewDto | null,
  history: [] as TreasuryDailyClosingDto[],
  caveatDrafts: {} as Record<string, string>,
  canClose: true,
  canReopen: true,
  busy: false,
  confirming: false,
  compareLeftId: "",
  compareRightId: "",
  compareLeft: null as TreasuryDailyClosingDto | null,
  compareRight: null as TreasuryDailyClosingDto | null,
  onCivilDateChange: noop,
  onCompanyCodeChange: noop,
  onNotesChange: noop,
  onCaveatDraftChange: noop,
  onRefreshPreview: noop,
  onRequestConfirm: noop,
  onCancelConfirm: noop,
  onConfirmClose: noop,
  onReopen: noop,
  onCompareLeftIdChange: noop,
  onCompareRightIdChange: noop,
};

describe("TreasuryDailyClosingPage — UI", () => {
  it("exibe estado sem permissão", () => {
    const html = renderToStaticMarkup(
      <TreasuryDailyClosingPanel {...baseProps} viewKind="denied" />
    );
    assert.match(html, /treasury-daily-closing-denied/);
    assert.match(html, /Sem permissão/);
  });

  it("renderiza resumo, contas, checklist, bloqueios, avisos, pendências e diferenças", () => {
    const html = renderToStaticMarkup(
      <TreasuryDailyClosingPanel
        {...baseProps}
        viewKind="ready"
        preview={samplePreview()}
        history={sampleHistory()}
        caveatDrafts={{ STALE_BALANCE: "Conferido" }}
      />
    );
    assert.match(html, /treasury-daily-closing-panel/);
    assert.match(html, /treasury-daily-closing-summary/);
    assert.match(html, /treasury-daily-closing-accounts/);
    assert.match(html, /treasury-daily-closing-checklist/);
    assert.match(html, /treasury-daily-closing-blocks/);
    assert.match(html, /treasury-daily-closing-warnings/);
    assert.match(html, /treasury-daily-closing-pendencies-ar/);
    assert.match(html, /treasury-daily-closing-differences/);
    assert.match(html, /treasury-daily-closing-caveats/);
    assert.match(html, /treasury-daily-closing-confirm/);
    assert.match(html, /treasury-daily-closing-history/);
    assert.match(html, /treasury-daily-closing-compare/);
    assert.match(html, /Cliente Alfa/);
    assert.match(html, /CX01/);
    assert.match(html, /Saldo desatualizado/);
  });

  it("mostra conflito 409 e etapa de confirmação", () => {
    const conflict = renderToStaticMarkup(
      <TreasuryDailyClosingPanel
        {...baseProps}
        viewKind="ready"
        preview={samplePreview()}
        conflictMessage={TREASURY_DAILY_CLOSING_409_MESSAGE}
      />
    );
    assert.match(conflict, /treasury-daily-closing-conflict/);
    assert.ok(conflict.includes(TREASURY_DAILY_CLOSING_409_MESSAGE));

    const confirming = renderToStaticMarkup(
      <TreasuryDailyClosingPanel
        {...baseProps}
        viewKind="ready"
        preview={samplePreview()}
        confirming
        caveatDrafts={{ STALE_BALANCE: "ok" }}
      />
    );
    assert.match(confirming, /treasury-daily-closing-confirm-submit/);
    assert.match(confirming, /Confirmar fechamento/);
  });

  it("histórico com reabertura e comparação de versões", () => {
    const history = sampleHistory();
    const html = renderToStaticMarkup(
      <TreasuryDailyClosingPanel
        {...baseProps}
        viewKind="ready"
        preview={samplePreview()}
        history={history}
        compareLeftId={history[0]!.id}
        compareRightId={history[1]!.id}
        compareLeft={history[0]!}
        compareRight={history[1]!}
      />
    );
    assert.match(html, /treasury-daily-closing-reopen/);
    assert.match(html, /treasury-daily-closing-diff-row/);
    assert.match(html, /Versão/);
  });

  it("página e módulo usam rota closing e atualizam preview antes de confirmar", () => {
    const page = readFileSync(join(here, "TreasuryDailyClosingPage.tsx"), "utf8");
    assert.match(page, /treasury-daily-closing-page/);
    assert.match(page, /TREASURY_DAILY_CLOSING_PAGE_TITLE/);
    assert.equal(TREASURY_DAILY_CLOSING_PAGE_TITLE, "Fechamento diário");
    assert.match(page, /refreshPreviewOnly/);
    assert.match(page, /resolveTreasuryDailyClosingConflictMessage/);
    assert.match(page, /onRequestConfirm/);
    assert.match(page, /closeTreasuryDailyClosing/);
    assert.match(page, /reopenTreasuryDailyClosing/);

    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    assert.match(moduleSrc, /path="closing"/);
    assert.match(moduleSrc, /TreasuryDailyClosingPage/);

    const featureUi = readFileSync(join(here, "treasuryFeatureUi.ts"), "utf8");
    assert.match(featureUi, /id: "closing"/);
    assert.match(featureUi, /Fechamento diário/);
  });
});
