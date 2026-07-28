import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryPayableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PAYABLES_DENIED_MESSAGE,
  TREASURY_PAYABLES_EMPTY_TITLE,
  TREASURY_PAYABLES_PAGE_TITLE,
  createEmptyTreasuryPayablesFilters,
  describeTreasuryPayableProgrammingRisk,
  previewTreasuryPayableProgrammingImpact,
} from "@/src/lib/treasury/treasuryPayablesUi.js";
import { TreasuryPayablesPanel } from "./TreasuryPayablesPanel.js";
import { TreasuryPayableDetailDrawer } from "./TreasuryPayableDetailDrawer.js";
import { TreasuryPayableProgrammingConfirmDialog } from "./TreasuryPayableProgrammingConfirmDialog.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

function noop() {}

function sampleRow(): TreasuryPayableListItemDto {
  return {
    titleId: "p1",
    externalId: 55100,
    official: {
      id: "p1",
      externalId: 55100,
      installmentNumber: null,
      installmentLabel: null,
      counterparty: {
        personId: 1,
        name: "Fornecedor Beta",
        taxId: "11222333000144",
        role: "SUPPLIER",
      },
      description: "NF 900",
      documentNumber: "DOC-900",
      classification: "Servico",
      comments: null,
      nomusScheduleDate: null,
      nomusScheduledAmount: null,
      salesOrderExternalId: null,
      salesOrderCode: null,
      invoice: { externalId: 900, number: "900" },
      issuedOn: "2026-06-01",
      dueDate: "2026-07-25",
      originalAmount: "1000.00",
      openBalance: "400.00",
      settlements: {
        settledAmount: "600.00",
        settledAt: "2026-07-10",
        paidAt: "2026-07-10",
      },
      cancellation: {
        isCancelledOrRemovedFromSource: false,
        sourcePresenceStatus: "PRESENT",
        sourceRemovedAt: null,
      },
      officialStatus: {
        nomusStatus: false,
        isOpen: true,
        isSettled: false,
        sourcePresenceStatus: "PRESENT",
      },
      lastSyncedAt: "2026-07-20T12:00:00.000+00:00",
    },
    complement: {
      id: "c1",
      expectedDate: null,
      confirmedDate: null,
      scheduledDate: "2026-08-10",
      expectedAmount: null,
      confirmedAmount: null,
      scheduledAmount: "200.00",
      status: "ACTIVE",
      priority: "HIGH",
      plannedAccountId: "acc-1",
      responsibleUserId: "user-1",
      nextAction: "PROGRAMMED",
      reason: "Programar",
      notes: "Obs",
      version: 1,
      updatedAt: "2026-07-21T10:00:00.000+00:00",
      cancelledAt: null,
    },
    classification: "Servico",
    costCenterId: null,
    costCenterLabel: null,
    openAmount: "400.00",
    paidAmount: "600.00",
    scheduledDate: "2026-08-10",
    scheduledAmount: "200.00",
    plannedAccountId: "acc-1",
    priority: "HIGH",
    notes: "Obs",
    daysOverdue: 0,
    operationalStatus: "PROGRAMMED",
    lastAction: {
      at: "2026-07-21T10:00:00.000+00:00",
      summary: "Programar",
    },
    nextAction: "PROGRAMMED",
  };
}

const panelBase = {
  rows: [] as TreasuryPayableListItemDto[],
  accounts: [],
  error: null as string | null,
  staleMessage: null as string | null,
  filters: createEmptyTreasuryPayablesFilters(),
  page: 1,
  pageSize: 50,
  totalPages: 1,
  titleCount: 0,
  openAmountTotal: "0.00",
  onFiltersChange: noop,
  onPageChange: noop,
  onRefresh: noop,
  onClearFilters: noop,
  onOpenDetails: noop,
};

describe("TreasuryPayablesPage — componentes e fluxo", () => {
  it("exibe estado sem permissão", () => {
    const html = renderToStaticMarkup(
      <TreasuryPayablesPanel {...panelBase} viewKind="denied" />
    );
    assert.match(html, /treasury-payables-permission-denied/);
    assert.ok(html.includes(TREASURY_PAYABLES_DENIED_MESSAGE));
  });

  it("exibe carregando, vazio, erro e stale", () => {
    const loading = renderToStaticMarkup(
      <TreasuryPayablesPanel {...panelBase} viewKind="loading" />
    );
    assert.match(loading, /Carregando contas a pagar/);

    const empty = renderToStaticMarkup(
      <TreasuryPayablesPanel {...panelBase} viewKind="empty" />
    );
    assert.ok(empty.includes(TREASURY_PAYABLES_EMPTY_TITLE));

    const error = renderToStaticMarkup(
      <TreasuryPayablesPanel
        {...panelBase}
        viewKind="error"
        error="Falha de rede"
      />
    );
    assert.match(error, /Falha de rede/);

    const stale = renderToStaticMarkup(
      <TreasuryPayablesPanel
        {...panelBase}
        viewKind="ready"
        rows={[sampleRow()]}
        titleCount={1}
        openAmountTotal="400.00"
        staleMessage="Dados possivelmente desatualizados"
      />
    );
    assert.match(stale, /treasury-payables-stale/);
  });

  it("lista título com status, prioridade, programação e summary", () => {
    const html = renderToStaticMarkup(
      <TreasuryPayablesPanel
        {...panelBase}
        viewKind="ready"
        rows={[sampleRow()]}
        titleCount={2}
        openAmountTotal="800.00"
      />
    );
    assert.match(html, /treasury-payables-table/);
    assert.match(html, /treasury-payables-mobile-list/);
    assert.match(html, /Fornecedor Beta/);
    assert.match(html, /treasury-payable-status-PROGRAMMED/);
    assert.match(html, /treasury-payables-summary/);
    assert.match(html, /filter-supplier/);
    assert.match(html, /filter-status/);
  });

  it("drawer e confirmação cobrem programação, impacto e histórico", () => {
    const drawer = readFileSync(
      join(here, "TreasuryPayableDetailDrawer.tsx"),
      "utf8"
    );
    assert.match(drawer, /treasury-payable-detail-drawer/);
    assert.match(drawer, /Programação de pagamento/);
    assert.match(drawer, /Bloqueio operacional/);
    assert.match(drawer, /Histórico operacional/);
    assert.match(drawer, /Observações/);
    assert.match(drawer, /TreasuryPayableProgrammingConfirmDialog/);
    assert.match(drawer, /previewTreasuryPayableProgrammingImpact/);
    assert.equal(typeof TreasuryPayableDetailDrawer, "function");

    const impact = previewTreasuryPayableProgrammingImpact({
      accountId: "acc-1",
      scheduledAmount: "90.00",
      accounts: [
        {
          id: "acc-1",
          companyCode: "X",
          companyName: null,
          code: "CX",
          name: "Caixa",
          institutionName: "B",
          institutionCode: null,
          accountType: "CHECKING",
          currency: "BRL",
          agencyMasked: "*",
          accountNumberMasked: "*",
          includeInConsolidated: true,
          minimumBalance: "0.00",
          allowNegativeBalance: true,
          liquidity: "IMMEDIATE",
          defaultBalanceOrigin: "MANUAL",
          sortOrder: 1,
          nomusBankAccountId: null,
          isActive: true,
          createdByUserId: "u1",
          createdAt: "2026-07-01T00:00:00.000+00:00",
          updatedAt: "2026-07-01T00:00:00.000+00:00",
          deactivatedAt: null,
          deactivatedByUserId: null,
          deactivationReason: null,
        },
      ],
      balancesByAccountId: { "acc-1": "50.00" },
    });
    const confirm = renderToStaticMarkup(
      <TreasuryPayableProgrammingConfirmDialog
        accountLabel="CX · Caixa"
        impact={impact}
        saving={false}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    assert.match(confirm, /treasury-payable-program-confirm-dialog/);
    assert.match(confirm, /treasury-payable-program-account-after/);
    assert.match(confirm, /treasury-payable-program-consolidated-after/);
    assert.match(confirm, /treasury-payable-program-risk/);
    assert.match(describeTreasuryPayableProgrammingRisk(impact), /Risco/);
  });

  it("wiring App + módulo + página existem sem Prisma", () => {
    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    const pageSrc = readFileSync(join(here, "TreasuryPayablesPage.tsx"), "utf8");
    const appSrc = readFileSync(join(repoRoot, "src/App.tsx"), "utf8");
    assert.match(moduleSrc, /TreasuryPayablesPage/);
    assert.match(moduleSrc, /path="payables"/);
    assert.match(pageSrc, /fetchTreasuryPayables/);
    assert.match(pageSrc, /TreasuryPayableDetailDrawer/);
    assert.doesNotMatch(pageSrc, /@prisma\/client|\.server\.js/);
    assert.match(appSrc, /TreasuryModule/);
    assert.ok(TREASURY_PAYABLES_PAGE_TITLE.length > 0);
  });
});
