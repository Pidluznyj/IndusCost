/**
 * Prompt 61 — E2E dos fluxos críticos da Central de Tesouraria.
 * Ferramenta real do projeto: Node test runner (`tsx --test`) + `renderToStaticMarkup`.
 * Overlay/portal depende de `document` (ausente no SSR) — drawers Overlay validados no fonte;
 * painéis, formulários e diálogos sem portal são renderizados.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import type {
  TreasuryAgendaDto,
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
  TreasuryDashboardDto,
  TreasuryFinancialAccountDto,
  TreasuryPayableListItemDto,
  TreasuryProjectionComparisonDto,
  TreasuryReceivableListItemDto,
  TreasuryReconciliationMatchDto,
  TreasuryReportDto,
  TreasuryTransferDto,
} from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_AGENDA_COLUMN_LABELS,
  TREASURY_AGENDA_DENIED_MESSAGE,
  createEmptyTreasuryAgendaFilters,
} from "@/src/lib/treasury/treasuryAgendaUi.js";
import {
  TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE,
  createEmptyTreasuryBankMovementsFilters,
} from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import {
  TREASURY_BALANCE_DENIED_MESSAGE,
  TREASURY_BALANCE_MANAGE_DENIED_MESSAGE,
  createEmptyTreasuryBalanceForm,
} from "@/src/lib/treasury/treasuryBalancesUi.js";
import { TREASURY_DAILY_CLOSING_PAGE_TITLE } from "@/src/lib/treasury/treasuryDailyClosingUi.js";
import {
  TREASURY_DASHBOARD_DENIED_MESSAGE,
  TREASURY_DASHBOARD_PAGE_TITLE,
  createEmptyTreasuryDashboardFilters,
} from "@/src/lib/treasury/treasuryDashboardUi.js";
import {
  TREASURY_PAYABLES_DENIED_MESSAGE,
  createEmptyTreasuryPayablesFilters,
} from "@/src/lib/treasury/treasuryPayablesUi.js";
import {
  TREASURY_COMPARISON_DENIED_MESSAGE,
  createEmptyTreasuryComparisonFilters,
} from "@/src/lib/treasury/treasuryProjectionComparisonUi.js";
import {
  TREASURY_RECEIVABLES_DENIED_MESSAGE,
  createEmptyTreasuryReceivablesFilters,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import {
  TREASURY_REPORTS_DENIED_MESSAGE,
  TREASURY_REPORTS_EXPORT_DENIED_MESSAGE,
  TREASURY_REPORTS_PAGE_TITLE,
  createEmptyTreasuryReportsFilters,
} from "@/src/lib/treasury/treasuryReportsUi.js";
import {
  TREASURY_TRANSFERS_DENIED_MESSAGE,
  createEmptyTreasuryTransferForm,
  createEmptyTreasuryTransfersFilters,
} from "@/src/lib/treasury/treasuryTransfersUi.js";
import { TreasuryAgendaPanel } from "./TreasuryAgendaPanel.js";
import { TreasuryBalanceUpdateForm } from "./TreasuryBalanceUpdateForm.js";
import { TreasuryBankMovementsPanel } from "./TreasuryBankMovementsPanel.js";
import { TreasuryDailyClosingPanel } from "./TreasuryDailyClosingPanel.js";
import { TreasuryDashboardPanel } from "./TreasuryDashboardPanel.js";
import { TreasuryOfxImportDialog } from "./TreasuryOfxImportDialog.js";
import { TreasuryPayablesPanel } from "./TreasuryPayablesPanel.js";
import { TreasuryProjectionComparisonPanel } from "./TreasuryProjectionComparisonPanel.js";
import { TreasuryReceivablePromisesSection } from "./TreasuryReceivablePromisesSection.js";
import { TreasuryReceivablesPanel } from "./TreasuryReceivablesPanel.js";
import { TreasuryReconciliationReverseConfirmDialog } from "./TreasuryReconciliationReverseConfirmDialog.js";
import { TreasuryReportsPanel } from "./TreasuryReportsPanel.js";
import { TreasuryTransferFormDialog } from "./TreasuryTransferFormDialog.js";
import { TreasuryTransfersPanel } from "./TreasuryTransfersPanel.js";
import {
  TREASURY_UI_BASE_PATH,
  TREASURY_UI_LABEL,
  TREASURY_UI_SECTIONS,
} from "./treasuryFeatureUi.js";

const here = dirname(fileURLToPath(import.meta.url));
const noop = () => undefined;

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function htmlRouter(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

const account: TreasuryFinancialAccountDto = {
  id: "acc-1",
  companyCode: "EMP1",
  companyName: "Emp",
  code: "CX01",
  name: "Caixa",
  institutionName: "Banco",
  institutionCode: "341",
  accountType: "CHECKING",
  currency: "BRL",
  agencyMasked: "***",
  accountNumberMasked: "****",
  includeInConsolidated: true,
  minimumBalance: "0.00",
  allowNegativeBalance: false,
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
};

function overdueReceivable(): TreasuryReceivableListItemDto {
  return {
    titleId: "ar-1",
    externalId: 88421,
    official: {
      id: "ar-1",
      externalId: 88421,
      installmentNumber: 1,
      installmentLabel: "1/1",
      counterparty: {
        personId: 1,
        name: "Cliente Atrasado",
        taxId: "12345678000199",
        role: "CUSTOMER",
      },
      description: "NF 100",
      documentNumber: null,
      salesOrderExternalId: 10,
      salesOrderCode: "PV-10",
      invoice: { externalId: 100, number: "100" },
      issuedOn: "2026-06-01",
      dueDate: "2026-07-10",
      originalAmount: "400.00",
      openBalance: "400.00",
      settlements: {
        settledAmount: "0.00",
        settledAt: null,
        paidAt: null,
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
    complement: null,
    sellerName: "Maria",
    commercialOwnerName: "Ana",
    openAmount: "400.00",
    receivedAmount: "0.00",
    daysOverdue: 10,
    operationalStatus: "OVERDUE",
    lastAction: null,
    nextAction: "Cobrar",
  };
}

function payableRow(): TreasuryPayableListItemDto {
  return {
    titleId: "ap-1",
    externalId: 55100,
    official: {
      id: "ap-1",
      externalId: 55100,
      installmentNumber: null,
      installmentLabel: null,
      counterparty: {
        personId: 2,
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
      originalAmount: "500.00",
      openBalance: "200.00",
      settlements: {
        settledAmount: "300.00",
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
    complement: null,
    classification: "Servico",
    costCenterId: null,
    costCenterLabel: null,
    openAmount: "200.00",
    paidAmount: "300.00",
    scheduledDate: null,
    scheduledAmount: null,
    plannedAccountId: null,
    priority: "NORMAL",
    notes: null,
    daysOverdue: 0,
    operationalStatus: "OPEN",
    lastAction: null,
    nextAction: null,
  };
}

function sampleDashboard(): TreasuryDashboardDto {
  return {
    ok: true,
    civilDate: "2026-07-27",
    scenario: "PROBABLE",
    accountIds: null,
    asOf: "2026-07-27T18:00:00.000-03:00",
    freshness: {
      asOf: "2026-07-27T18:00:00.000-03:00",
      sources: [],
      hasStaleSource: false,
      staleSourceCount: 0,
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
    accounts: [],
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
    priorityExceptions: [],
    alerts: [],
    composition: [],
    origins: { observed: "BALANCE_SNAPSHOT / consolidated" },
  };
}

function sampleComparison(): TreasuryProjectionComparisonDto {
  return {
    ok: true,
    companyCode: "EMP1",
    baseDate: "2026-07-27",
    endDate: "2026-07-28",
    consolidated: true,
    accountIds: null,
    recalculated: false,
    scenarios: [
      {
        scenario: "CONTRACTUAL",
        runId: "r1",
        sourceVersion: "s1",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: null,
        minimumBalance: "1000.00",
        minimumBalanceDate: "2026-07-27",
        dayCount: 2,
      },
      {
        scenario: "PROBABLE",
        runId: "r2",
        sourceVersion: "s2",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: "2026-07-28",
        minimumBalance: "-10.00",
        minimumBalanceDate: "2026-07-28",
        dayCount: 2,
      },
      {
        scenario: "CONFIRMED",
        runId: "r3",
        sourceVersion: "s3",
        algorithmVersion: "a1",
        available: true,
        freshness: null,
        firstNegativeDate: null,
        minimumBalance: "900.00",
        minimumBalanceDate: "2026-07-28",
        dayCount: 2,
      },
    ],
    days: [
      {
        civilDate: "2026-07-27",
        balances: {
          CONTRACTUAL: "1000.00",
          PROBABLE: "1100.00",
          CONFIRMED: "1050.00",
        },
        differences: {
          probableMinusContractual: "100.00",
          confirmedMinusProbable: "-50.00",
          confirmedMinusContractual: "50.00",
        },
        uncertainReceivables: {
          CONTRACTUAL: "40.00",
          PROBABLE: "20.00",
          CONFIRMED: "0.00",
          max: "40.00",
          primary: "40.00",
        },
        highestRisk: {
          riskCode: "MEDIUM",
          riskAmount: "15.00",
          riskLabel: "Risco Médio (MEDIUM): 15.00",
          scenario: "CONTRACTUAL",
        },
      },
    ],
    summary: {
      firstNegativeDateOverall: "2026-07-28",
      minimumBalanceOverall: "-10.00",
      minimumBalanceOverallDate: "2026-07-28",
      minimumBalanceOverallScenario: "PROBABLE",
    },
    freshness: {
      asOf: "2026-07-27T18:00:00.000Z",
      sources: [],
      hasStaleSource: false,
      staleSourceCount: 0,
    },
    maxHorizonDays: 90,
  };
}

function sampleAgenda(): TreasuryAgendaDto {
  return {
    ok: true,
    runId: "run-1",
    companyCode: "EMP1",
    scenario: "PROBABLE",
    baseDate: "2026-07-27",
    endDate: "2026-07-28",
    consolidated: true,
    accountIds: null,
    sourceVersion: "src",
    algorithmVersion: "algo-1",
    freshness: {
      asOf: "2026-07-27T18:00:00.000-03:00",
      sources: [],
      hasStaleSource: false,
      staleSourceCount: 0,
    },
    days: [
      {
        civilDate: "2026-07-27",
        accountId: null,
        accountCode: null,
        accountName: null,
        openingBalance: "1000.00",
        plannedInflows: "200.00",
        confirmedInflows: "100.00",
        realizedInflows: "50.00",
        plannedOutflows: "80.00",
        programmedOutflows: "60.00",
        realizedOutflows: "20.00",
        transfers: "0.00",
        closingBalance: "1120.00",
        riskAmount: "15.00",
        riskCode: "MEDIUM",
        riskLabel: "Risco Médio (MEDIUM): 15.00",
        inflows: "180.00",
        outflows: "60.00",
        net: "120.00",
        realized: "30.00",
        itemCount: 1,
        items: [],
        alerts: [],
      },
    ],
    alerts: [],
    maxHorizonDays: 90,
  };
}

function closingPreview(): TreasuryDailyClosingPreviewDto {
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
    pendingReceivables: [],
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

function closedHistory(): TreasuryDailyClosingDto[] {
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
  ];
}

const closingBase = {
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

const match: TreasuryReconciliationMatchDto = {
  id: "match-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  status: "MATCHED",
  matchedAmount: "150.00",
  currency: "BRL",
  matchedCivilDate: "2026-07-15",
  justification: "E2E",
  suggestionKey: null,
  algorithmVersion: null,
  suggestionScore: null,
  suggestionConfidence: null,
  suggestionReasons: null,
  version: 1,
  movements: [
    {
      id: "mm-1",
      matchId: "match-1",
      bankMovementId: "mov-1",
      amount: "150.00",
      sortOrder: 0,
    },
  ],
  allocations: [
    {
      id: "al-1",
      matchId: "match-1",
      kind: "TITLE",
      amount: "150.00",
      memo: null,
      nomusSide: "AR",
      officialTitleId: "ar-1",
      nomusExternalId: 88421,
      transferId: null,
      transferGroupId: null,
      ledgerEntryId: null,
      differenceCode: null,
      sortOrder: 0,
    },
  ],
  createdAt: "2026-07-20T00:00:00.000+00:00",
  createdByUserId: "u1",
  updatedAt: "2026-07-20T00:00:00.000+00:00",
  updatedByUserId: null,
  unmatchedAt: null,
  unmatchedByUserId: null,
  unmatchReason: null,
  isReversed: false,
  doesNotRealizeOfficial: true,
};

const movement: TreasuryBankMovementDto = {
  id: "mov-1",
  batchId: "batch-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  accountCode: "CX01",
  accountName: "Caixa",
  fingerprint: "fp1",
  fitId: "FIT-1",
  direction: "CREDIT",
  amount: "150.00",
  currency: "BRL",
  postedCivilDate: "2026-07-15",
  userCivilDate: null,
  description: "Recebimento OFX",
  documentNumber: null,
  counterpartyName: "Cliente Atrasado",
  trnType: "CREDIT",
  reconciliationStatus: "MATCHED",
  reconciledAmount: "150.00",
  sortOrder: 0,
  createdAt: "2026-07-20T12:01:00.000+00:00",
};

const batch: TreasuryBankImportBatchDto = {
  id: "batch-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  accountCode: "CX01",
  accountName: "Caixa",
  fileSha256: "abc",
  originalFileName: "extrato.ofx",
  byteLength: 100,
  format: "OFX1",
  status: "PROCESSED",
  transactionCount: 1,
  summaryJson: { createdCount: 1 },
  requestId: null,
  notes: null,
  createdByUserId: "u1",
  createdAt: "2026-07-20T12:00:00.000+00:00",
  processedAt: "2026-07-20T12:01:00.000+00:00",
};

function sampleReport(): TreasuryReportDto {
  return {
    ok: true,
    reportKey: "daily-position",
    period: { from: "2026-07-27", to: "2026-07-27" },
    accountIds: null,
    authorizedAccountIds: ["acc-1"],
    scenario: null,
    filters: {},
    totals: {
      amount: "100.00",
      count: 1,
      extras: { bucketAmountSum: "100.00", bucketCountSum: 1 },
    },
    composition: [
      {
        key: "observed",
        label: "Saldo observado",
        amount: "100.00",
        count: 1,
        sharePercent: "100.00",
      },
    ],
    rows: [{ id: "acc-1", label: "Caixa", amount: "100.00", accountId: "acc-1" }],
    pagination: null,
  };
}

const transfer: TreasuryTransferDto = {
  id: "tr-1",
  transferGroupId: "tg-1",
  companyCode: "EMP1",
  fromAccountId: "acc-1",
  toAccountId: "acc-2",
  civilDate: "2026-07-27",
  amount: "50.00",
  currency: "BRL",
  status: "FORECAST",
  memo: "E2E",
  fundsInTransit: false,
  sentCivilDate: null,
  receivedCivilDate: null,
  reconciledCivilDate: null,
  sentAt: null,
  receivedAt: null,
  reconciledAt: null,
  version: 1,
  createdAt: "2026-07-27T12:00:00.000+00:00",
  createdByUserId: "u1",
  updatedAt: "2026-07-27T12:00:00.000+00:00",
  updatedByUserId: null,
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
};

describe("TreasuryCriticalFlows E2E — ferramenta tsx --test", () => {
  it("1–14: fluxo principal crítico (UI render + wiring Overlay)", () => {
    // 1) acessar Central de Tesouraria (shell monta páginas com Auth — valida fonte + contrato UI)
    const moduleSrc = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    const featureSrc = readFileSync(join(here, "treasuryFeatureUi.ts"), "utf8");
    assert.match(moduleSrc, /data-testid="treasury-module"/);
    assert.match(moduleSrc, /data-testid="treasury-module-tabs"/);
    assert.equal(TREASURY_UI_LABEL, "Central de Tesouraria");
    assert.equal(TREASURY_UI_BASE_PATH, "/finance/treasury");
    assert.ok(TREASURY_UI_SECTIONS.length >= 11);
    for (const section of TREASURY_UI_SECTIONS) {
      assert.ok(featureSrc.includes(section.label), `seção ${section.id}`);
      assert.ok(featureSrc.includes(section.path) || featureSrc.includes(`/${section.id}`));
    }
    assert.ok(moduleSrc.includes('path="closing"'));
    assert.ok(moduleSrc.includes('path="reports"'));
    assert.ok(moduleSrc.includes('path="transfers"'));
    assert.ok(moduleSrc.includes("bank-movements"));

    // 2) registrar saldo
    const balance = html(
      <TreasuryBalanceUpdateForm
        form={createEmptyTreasuryBalanceForm()}
        canManage
        saving={false}
        error={null}
        isConflict={false}
        onChange={noop}
        onSubmitRequest={noop}
        onReload={noop}
      />
    );
    assert.match(balance, /treasury-balance-update-form/);
    assert.match(balance, /treasury-balance-submit/);

    // 3) visualizar dashboard
    const dash = htmlRouter(
      <TreasuryDashboardPanel
        viewKind="ready"
        dashboard={sampleDashboard()}
        accounts={[account]}
        error={null}
        staleMessage={null}
        recalculating={false}
        filters={createEmptyTreasuryDashboardFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
        onOpenTotal={noop}
      />
    );
    assert.match(dash, /treasury-dashboard-panel/);
    assert.ok(dash.includes(TREASURY_DASHBOARD_PAGE_TITLE) || dash.includes("Divergência"));
    assert.match(dash, /1\.500,00|1500/);

    // 4) abrir recebível atrasado
    const ar = html(
      <TreasuryReceivablesPanel
        viewKind="ready"
        rows={[overdueReceivable()]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryReceivablesFilters()}
        page={1}
        pageSize={50}
        totalPages={1}
        titleCount={1}
        openAmountTotal="400.00"
        onFiltersChange={noop}
        onPageChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(ar, /treasury-receivable-status-OVERDUE/);
    assert.match(ar, /Cliente Atrasado/);
    assert.match(ar, /treasury-receivables-open-88421/);

    // 5) registrar promessa (seção fora do Overlay)
    const promise = html(
      <TreasuryReceivablePromisesSection
        titleId="ar-1"
        openAmount="400.00"
        canPromise
      />
    );
    assert.match(promise, /treasury-receivable-promises/);
    assert.match(promise, /treasury-promise-create-form/);
    assert.match(promise, /treasury-promise-create-submit/);
    assert.match(promise, /Nova promessa/);

    // 6) verificar projeção
    const projection = html(
      <TreasuryProjectionComparisonPanel
        viewKind="ready"
        comparison={sampleComparison()}
        accounts={[account]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryComparisonFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.match(projection, /treasury-comparison-panel|Comparação|Maior risco|Risco Médio/);
    assert.ok(projection.includes("Risco Médio (MEDIUM): 15.00"));

    // 7) programar pagamento — lista + wiring drawer Overlay no fonte
    const ap = html(
      <TreasuryPayablesPanel
        viewKind="ready"
        rows={[payableRow()]}
        accounts={[account]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryPayablesFilters()}
        page={1}
        pageSize={50}
        totalPages={1}
        titleCount={1}
        openAmountTotal="200.00"
        onFiltersChange={noop}
        onPageChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(ap, /Fornecedor Beta/);
    assert.match(ap, /treasury-payables-table/);
    const payableDrawerSrc = readFileSync(
      join(here, "TreasuryPayableDetailDrawer.tsx"),
      "utf8"
    );
    assert.match(payableDrawerSrc, /treasury-payable-programming-form/);
    assert.match(payableDrawerSrc, /treasury-payable-program-date/);
    assert.match(payableDrawerSrc, /treasury-payable-program-amount/);
    assert.match(payableDrawerSrc, /Programação de pagamento/);
    // init síncrono do form (falha de 1º paint corrigida)
    assert.match(payableDrawerSrc, /useState<ProgramFormState \| null>\(\(\) =>/);

    // 8) visualizar risco
    const agenda = html(
      <TreasuryAgendaPanel
        viewKind="ready"
        agenda={sampleAgenda()}
        accounts={[account]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryAgendaFilters("2026-07-27")}
        onFiltersChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
      />
    );
    assert.ok(agenda.includes(TREASURY_AGENDA_COLUMN_LABELS.risk));
    assert.match(agenda, /Risco Médio \(MEDIUM\): 15\.00/);

    // 9) registrar transferência
    const transfers = html(
      <TreasuryTransfersPanel
        items={[transfer]}
        accounts={[account, { ...account, id: "acc-2", code: "CX02", name: "Caixa 2" }]}
        filters={createEmptyTreasuryTransfersFilters()}
        canManage
        onFiltersChange={noop}
        onCreate={noop}
        onSchedule={noop}
        onSend={noop}
        onReceive={noop}
        onReconcile={noop}
        onCancel={noop}
      />
    );
    assert.match(transfers, /treasury-transfers-panel/);
    assert.match(transfers, /Nova transferência/);
    const transferForm = html(
      <TreasuryTransferFormDialog
        open
        accounts={[account, { ...account, id: "acc-2", code: "CX02", name: "Caixa 2" }]}
        form={createEmptyTreasuryTransferForm("2026-07-27")}
        error={null}
        saving={false}
        onChange={noop}
        onClose={noop}
        onSubmit={noop}
      />
    );
    assert.match(transferForm, /treasury-transfer-form-dialog/);
    assert.match(transferForm, /items-end/);
    assert.match(transferForm, /sm:items-center/);

    // 10) fechar com ressalva
    const closing = html(
      <TreasuryDailyClosingPanel
        {...closingBase}
        viewKind="ready"
        preview={closingPreview()}
        history={closedHistory()}
        caveatDrafts={{ STALE_BALANCE: "Conferido no E2E" }}
        confirming
      />
    );
    assert.equal(TREASURY_DAILY_CLOSING_PAGE_TITLE, "Fechamento diário");
    assert.match(closing, /treasury-daily-closing-caveats/);
    assert.match(closing, /Ressalva obrigatória/);
    assert.match(closing, /STALE_BALANCE/);
    assert.match(closing, /treasury-daily-closing-confirm-submit/);

    // 11) importar OFX
    const ofx = html(
      <TreasuryOfxImportDialog
        open
        accounts={[account]}
        onClose={noop}
        onApplied={noop}
      />
    );
    assert.match(ofx, /treasury-ofx-import-dialog/);
    assert.match(ofx, /treasury-ofx-step-upload/);
    assert.match(ofx, /Importar OFX/);
    const bankPanel = html(
      <TreasuryBankMovementsPanel
        filters={createEmptyTreasuryBankMovementsFilters()}
        accounts={[account]}
        batches={[batch]}
        movements={[movement]}
        selected={movement}
        activeMatches={[match]}
        canManage
        canReverse
        duplicatesMessage={null}
        onFiltersChange={noop}
        onImport={noop}
        onSelectMovement={noop}
        onClearSelection={noop}
        onSelectBatch={noop}
        onReverseMatch={noop}
      />
    );
    assert.match(bankPanel, /Importar OFX/);
    assert.match(bankPanel, /extrato\.ofx/);

    // 12) conciliar movimento (UI: match ativo + confirmação de reversão)
    assert.match(bankPanel, /treasury-bank-movement-active-matches|Conciliado|Reverter/);
    assert.match(bankPanel, /treasury-reverse-match-match-1/);
    const reverse = html(
      <TreasuryReconciliationReverseConfirmDialog
        open
        match={match}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    assert.match(reverse, /treasury-reconciliation-reverse-dialog/);
    assert.match(reverse, /Reverter conciliação/);
    assert.ok(reverse.includes(TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE));

    // 13) gerar relatório
    const report = html(
      <TreasuryReportsPanel
        viewKind="ready"
        report={sampleReport()}
        generatedAt="2026-07-27T18:00:00.000-03:00"
        error={null}
        filters={createEmptyTreasuryReportsFilters()}
        canExport
        onFiltersChange={noop}
        onRefresh={noop}
        onExport={noop}
        onPrint={noop}
      />
    );
    assert.ok(report.includes(TREASURY_REPORTS_PAGE_TITLE) || report.includes("treasury-reports"));
    assert.match(report, /treasury-reports-generated-at/);
    assert.match(report, /treasury-reports-export-csv/);
    assert.match(report, /Saldo observado/);

    // 14) reabrir o dia com permissão
    assert.match(closing, /treasury-daily-closing-reopen/);
    assert.match(closing, /Reabrir/);
    const noReopen = html(
      <TreasuryDailyClosingPanel
        {...closingBase}
        viewKind="ready"
        preview={closingPreview()}
        history={closedHistory()}
        canReopen={false}
        caveatDrafts={{ STALE_BALANCE: "ok" }}
      />
    );
    assert.doesNotMatch(noReopen, /treasury-daily-closing-reopen/);
  });

  it("nega acesso sem permissão nos fluxos críticos", () => {
    const denied = [
      htmlRouter(
        <TreasuryDashboardPanel
          viewKind="denied"
          dashboard={null}
          accounts={[]}
          error={null}
          staleMessage={null}
          recalculating={false}
          filters={createEmptyTreasuryDashboardFilters("2026-07-27")}
          onFiltersChange={noop}
          onRefresh={noop}
          onClearFilters={noop}
          onOpenTotal={noop}
        />
      ),
      html(
        <PermissionDenied
          title="Sem permissão"
          message={TREASURY_BALANCE_DENIED_MESSAGE}
          testId="treasury-balance-permission-denied"
        />
      ),
      html(
        <TreasuryReceivablesPanel
          viewKind="denied"
          rows={[]}
          error={null}
          staleMessage={null}
          filters={createEmptyTreasuryReceivablesFilters()}
          page={1}
          pageSize={50}
          totalPages={1}
          titleCount={0}
          openAmountTotal="0.00"
          onFiltersChange={noop}
          onPageChange={noop}
          onRefresh={noop}
          onClearFilters={noop}
          onOpenDetails={noop}
        />
      ),
      html(
        <TreasuryPayablesPanel
          viewKind="denied"
          rows={[]}
          accounts={[]}
          error={null}
          staleMessage={null}
          filters={createEmptyTreasuryPayablesFilters()}
          page={1}
          pageSize={50}
          totalPages={1}
          titleCount={0}
          openAmountTotal="0.00"
          onFiltersChange={noop}
          onPageChange={noop}
          onRefresh={noop}
          onClearFilters={noop}
          onOpenDetails={noop}
        />
      ),
      html(
        <TreasuryAgendaPanel
          viewKind="denied"
          agenda={null}
          accounts={[]}
          error={null}
          staleMessage={null}
          filters={createEmptyTreasuryAgendaFilters("2026-07-27")}
          onFiltersChange={noop}
          onRefresh={noop}
          onClearFilters={noop}
        />
      ),
      html(
        <TreasuryProjectionComparisonPanel
          viewKind="denied"
          comparison={null}
          accounts={[]}
          error={null}
          staleMessage={null}
          filters={createEmptyTreasuryComparisonFilters("2026-07-27")}
          onFiltersChange={noop}
          onRefresh={noop}
          onClearFilters={noop}
        />
      ),
      html(
        <PermissionDenied
          title="Sem permissão"
          message={TREASURY_TRANSFERS_DENIED_MESSAGE}
          testId="treasury-transfers-permission-denied"
        />
      ),
      html(
        <PermissionDenied
          title="Sem permissão"
          message={TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE}
          testId="treasury-bank-movements-permission-denied"
        />
      ),
      html(
        <TreasuryDailyClosingPanel {...closingBase} viewKind="denied" />
      ),
      html(
        <TreasuryReportsPanel
          viewKind="denied"
          report={null}
          generatedAt={null}
          error={null}
          filters={createEmptyTreasuryReportsFilters()}
          canExport={false}
          onFiltersChange={noop}
          onRefresh={noop}
          onExport={noop}
          onPrint={noop}
        />
      ),
    ];

    assert.ok(denied[0]!.includes(TREASURY_DASHBOARD_DENIED_MESSAGE));
    assert.ok(denied[1]!.includes(TREASURY_BALANCE_DENIED_MESSAGE));
    assert.ok(denied[2]!.includes(TREASURY_RECEIVABLES_DENIED_MESSAGE));
    assert.ok(denied[3]!.includes(TREASURY_PAYABLES_DENIED_MESSAGE));
    assert.ok(denied[4]!.includes(TREASURY_AGENDA_DENIED_MESSAGE));
    assert.ok(denied[5]!.includes(TREASURY_COMPARISON_DENIED_MESSAGE));
    assert.ok(denied[6]!.includes(TREASURY_TRANSFERS_DENIED_MESSAGE));
    assert.match(denied[6]!, /treasury-transfers-permission-denied/);
    assert.ok(denied[7]!.includes(TREASURY_BANK_MOVEMENTS_DENIED_MESSAGE));
    assert.match(denied[7]!, /treasury-bank-movements-permission-denied/);
    assert.match(denied[8]!, /treasury-daily-closing-denied/);
    assert.ok(denied[9]!.includes(TREASURY_REPORTS_DENIED_MESSAGE));

    const balanceReadonly = html(
      <TreasuryBalanceUpdateForm
        form={createEmptyTreasuryBalanceForm()}
        canManage={false}
        saving={false}
        error={null}
        isConflict={false}
        onChange={noop}
        onSubmitRequest={noop}
        onReload={noop}
      />
    );
    assert.match(balanceReadonly, /treasury-balance-form-readonly/);
    assert.ok(
      balanceReadonly.includes(TREASURY_BALANCE_MANAGE_DENIED_MESSAGE) ||
        balanceReadonly.includes("Sem permissão")
    );

    const noExport = html(
      <TreasuryReportsPanel
        viewKind="empty"
        report={null}
        generatedAt={null}
        error={null}
        filters={createEmptyTreasuryReportsFilters()}
        canExport={false}
        onFiltersChange={noop}
        onRefresh={noop}
        onExport={noop}
        onPrint={noop}
      />
    );
    assert.ok(
      noExport.includes(TREASURY_REPORTS_EXPORT_DENIED_MESSAGE) ||
        !noExport.includes("treasury-reports-export-csv")
    );

    const noPromise = html(
      <TreasuryReceivablePromisesSection
        titleId="ar-1"
        openAmount="400.00"
        canPromise={false}
      />
    );
    assert.doesNotMatch(noPromise, /treasury-promise-create-form/);

    const transfersPage = readFileSync(join(here, "TreasuryTransfersPage.tsx"), "utf8");
    assert.match(transfersPage, /treasury-transfers-permission-denied/);
    const bankPage = readFileSync(join(here, "TreasuryBankMovementsPage.tsx"), "utf8");
    assert.match(bankPage, /treasury-bank-movements-permission-denied/);
  });

  it("responsividade essencial: tabelas desktop/mobile e sheets", () => {
    const ar = html(
      <TreasuryReceivablesPanel
        viewKind="ready"
        rows={[overdueReceivable()]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryReceivablesFilters()}
        page={1}
        pageSize={50}
        totalPages={1}
        titleCount={1}
        openAmountTotal="400.00"
        onFiltersChange={noop}
        onPageChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(ar, /treasury-receivables-table/);
    assert.match(ar, /hidden xl:block|xl:block/);
    assert.match(ar, /treasury-receivables-mobile-list/);
    assert.match(ar, /md:hidden/);

    const ap = html(
      <TreasuryPayablesPanel
        viewKind="ready"
        rows={[payableRow()]}
        accounts={[account]}
        error={null}
        staleMessage={null}
        filters={createEmptyTreasuryPayablesFilters()}
        page={1}
        pageSize={50}
        totalPages={1}
        titleCount={1}
        openAmountTotal="200.00"
        onFiltersChange={noop}
        onPageChange={noop}
        onRefresh={noop}
        onClearFilters={noop}
        onOpenDetails={noop}
      />
    );
    assert.match(ap, /treasury-payables-table/);
    assert.match(ap, /treasury-payables-mobile-list/);
    assert.match(ap, /xl:hidden|xl:block/);

    const transferForm = html(
      <TreasuryTransferFormDialog
        open
        accounts={[account]}
        form={createEmptyTreasuryTransferForm("2026-07-27")}
        error={null}
        saving={false}
        onChange={noop}
        onClose={noop}
        onSubmit={noop}
      />
    );
    assert.match(transferForm, /items-end/);
    assert.match(transferForm, /sm:items-center/);

    const moduleResponsive = readFileSync(join(here, "TreasuryModule.tsx"), "utf8");
    assert.match(moduleResponsive, /sm:text-2xl/);
    assert.match(moduleResponsive, /flex flex-wrap/);

    const reportsSrc = readFileSync(join(here, "TreasuryReportsPanel.tsx"), "utf8");
    assert.match(reportsSrc, /print:hidden|overflow-x-auto|sm:grid-cols-2/);
  });
});
