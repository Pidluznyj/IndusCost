import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TreasuryDashboardDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_DASHBOARD_DENIED_MESSAGE,
  TREASURY_DASHBOARD_EMPTY_TITLE,
  TREASURY_DASHBOARD_PAGE_TITLE,
  TREASURY_DASHBOARD_RECALCULATING_MESSAGE,
  createEmptyTreasuryDashboardFilters,
} from "@/src/lib/treasury/treasuryDashboardUi.js";
import { TreasuryDashboardPanel } from "./TreasuryDashboardPanel.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleDashboard(): TreasuryDashboardDto {
  return {
    ok: true,
    civilDate: "2026-07-27",
    scenario: "PROBABLE",
    accountIds: null,
    asOf: "2026-07-27T18:00:00.000-03:00",
    freshness: {
      asOf: "2026-07-27T18:00:00.000-03:00",
      sources: [
        {
          source: "OFFICIAL_RECEIVABLES",
          label: "CR oficiais",
          lastSuccessAt: "2026-07-20T12:00:00.000-03:00",
          isStale: true,
          detail: "Sync antigo",
        },
      ],
      hasStaleSource: true,
      staleSourceCount: 1,
    },
    observedBalance: "1500.00",
    calculatedBalance: "1400.00",
    reconciledBalance: null,
    divergence: "100.00",
    hasDivergence: true,
    receipts: {
      kind: "RECEIPTS",
      plannedAmount: "200.00",
      plannedTitleCount: 2,
      realizedAmount: "50.00",
      realizedTitleCount: 1,
      pendingAmount: "200.00",
      pendingTitleCount: 2,
    },
    payments: {
      kind: "PAYMENTS",
      plannedAmount: "80.00",
      plannedTitleCount: 1,
      realizedAmount: "20.00",
      realizedTitleCount: 1,
      pendingAmount: "80.00",
      pendingTitleCount: 1,
    },
    currentBalance: "1500.00",
    currentBalanceOrigin: "CONSOLIDATED_OBSERVED",
    projectedClosingBalance: "1620.00",
    projectedClosingOrigin:
      "CURRENT_PLUS_PLANNED_RECEIPTS_MINUS_PLANNED_PAYMENTS",
    titleCount: {
      receivablesPlanned: 2,
      receivablesRealized: 1,
      receivablesPending: 2,
      payablesPlanned: 1,
      payablesRealized: 1,
      payablesPending: 1,
      totalBucketSum: 5,
      openOnDay: 3,
    },
    accounts: [
      {
        accountId: "acc-1",
        accountCode: "CX01",
        accountName: "Caixa",
        accountType: "CHECKING",
        includeInConsolidated: true,
        liquidity: "IMMEDIATE",
        allowNegativeBalance: false,
        isNegative: false,
        hasSnapshot: true,
        snapshotId: "s1",
        snapshotReferenceAt: "2026-07-27T10:00:00.000-03:00",
        snapshotOrigin: "MANUAL",
        observedBalance: "1500.00",
        operationalAvailableBalance: "1500.00",
        calculatedBalance: "1400.00",
        reconciledBalance: null,
        divergence: "100.00",
        hasDivergence: true,
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        officialMovementCount: 1,
        officialMovementNet: "-100.00",
        origins: {
          observed: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          operationalAvailable: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          calculated: {
            origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
            detail: "ok",
          },
          reconciled: { origin: "MISSING", detail: "ausente" },
          blocked: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          investments: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          usedLimit: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
        },
        alerts: ["Divergência"],
        layers: ["observed", "calculated"],
      },
    ],
    consolidated: {
      accountCount: 1,
      includedAccountCount: 1,
      excludedAccountCount: 0,
      accountsMissingSnapshot: 0,
      observedBalance: "1500.00",
      operationalAvailableBalance: "1500.00",
      calculatedBalance: "1400.00",
      reconciledBalance: null,
      divergence: "100.00",
      hasDivergence: true,
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      alerts: [],
    },
    priorityExceptions: [
      {
        id: "ex-1",
        type: "BALANCE_DIVERGENCE",
        severity: "CRITICAL",
        status: "OPEN",
        title: "Divergência de saldo na conta CX01",
        accountId: "acc-1",
        nomusExternalId: null,
        source: "FINANCIAL_POSITION",
      },
    ],
    alerts: [
      {
        id: "alert:STALE_BALANCE:acc-1",
        kind: "STALE_BALANCE",
        severity: "WARNING",
        title: "Saldo desatualizado",
        description: "Saldo da conta CX01 desatualizado.",
        amount: "1500.00",
        accountId: "acc-1",
        civilDate: "2026-07-27",
        entityId: "acc-1",
        metadata: null,
      },
    ],
    composition: [
      {
        key: "observedBalance",
        label: "Saldo observado (consolidado)",
        amount: "1500.00",
        titleCount: 1,
        origin: "BALANCE_SNAPSHOT",
        detailable: true,
      },
    ],
    origins: {
      observed: "BALANCE_SNAPSHOT / consolidated",
    },
  };
}

const basePanelProps = {
  accounts: [],
  error: null as string | null,
  staleMessage: null as string | null,
  recalculating: false,
  filters: createEmptyTreasuryDashboardFilters("2026-07-27"),
  onFiltersChange: noop,
  onRefresh: noop,
  onClearFilters: noop,
  onOpenTotal: noop,
};

function renderPanel(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("TreasuryDashboardPage — componentes e fluxo", () => {
  it("exibe estado sem permissão", () => {
    const html = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="denied"
        dashboard={null}
      />
    );
    assert.match(html, /treasury-dashboard-permission-denied/);
    assert.match(html, new RegExp(TREASURY_DASHBOARD_DENIED_MESSAGE));
  });

  it("exibe carregando, vazio, erro, stale e recálculo", () => {
    const loading = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="loading"
        dashboard={null}
      />
    );
    assert.match(loading, /treasury-dashboard-loading/);

    const empty = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="empty"
        dashboard={null}
      />
    );
    assert.match(empty, /treasury-dashboard-empty/);
    assert.match(empty, new RegExp(TREASURY_DASHBOARD_EMPTY_TITLE));

    const error = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="error"
        dashboard={null}
        error="Falha de rede"
      />
    );
    assert.match(error, /treasury-dashboard-error/);
    assert.match(error, /Falha de rede/);

    const ready = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="ready"
        dashboard={sampleDashboard()}
        staleMessage="Dados desatualizados: fonte stale"
        recalculating
      />
    );
    assert.match(ready, /treasury-dashboard-stale/);
    assert.match(ready, /treasury-dashboard-recalculating/);
    assert.match(ready, new RegExp(TREASURY_DASHBOARD_RECALCULATING_MESSAGE));
  });

  it("lista cards, previsto/realizado, posição, exceções, alertas e atalhos", () => {
    const html = renderPanel(
      <TreasuryDashboardPanel
        {...basePanelProps}
        viewKind="ready"
        dashboard={sampleDashboard()}
      />
    );
    assert.match(html, /treasury-dashboard-card-observed/);
    assert.match(html, /treasury-dashboard-card-divergence/);
    assert.match(html, /treasury-dashboard-planned-realized/);
    assert.match(html, /Recebimentos do dia/);
    assert.match(html, /Pagamentos do dia/);
    assert.match(html, /treasury-dashboard-account-acc-1/);
    assert.match(html, /CX01/);
    assert.match(html, /treasury-dashboard-exception-ex-1/);
    assert.match(html, /Crítico/);
    assert.match(html, /treasury-dashboard-alerts/);
    assert.match(html, /Desatualizada/);
    assert.match(html, /treasury-dashboard-shortcut-receivables/);
    assert.match(html, /treasury-dashboard-filter-date/);
    assert.match(html, /treasury-dashboard-filter-period/);
    assert.match(html, /treasury-dashboard-filter-account/);
    assert.match(html, /treasury-dashboard-filter-scenario/);
    assert.match(html, /Clique para detalhar/);
    assert.match(html, /Sem divergência|Divergência/);
  });

  it("wiring App + módulo + página usam dashboard e drawer sem Prisma", () => {
    const moduleSrc = readFileSync(
      join(here, "TreasuryModule.tsx"),
      "utf8"
    );
    const pageSrc = readFileSync(
      join(here, "TreasuryDashboardPage.tsx"),
      "utf8"
    );
    const drawerSrc = readFileSync(
      join(here, "TreasuryDashboardDetailDrawer.tsx"),
      "utf8"
    );
    const appSrc = readFileSync(join(repoRoot, "src/App.tsx"), "utf8");

    assert.match(moduleSrc, /TreasuryDashboardPage/);
    assert.match(pageSrc, /fetchTreasuryDashboard/);
    assert.match(pageSrc, /TreasuryDashboardDetailDrawer/);
    assert.match(drawerSrc, /treasury-dashboard-detail-drawer/);
    assert.match(drawerSrc, /Overlay/);
    assert.match(appSrc, /TreasuryModule/);
    assert.doesNotMatch(pageSrc, /@prisma\/client/);
    assert.doesNotMatch(pageSrc, /\.server\.js/);
    assert.ok(TREASURY_DASHBOARD_PAGE_TITLE.length > 0);
  });
});
