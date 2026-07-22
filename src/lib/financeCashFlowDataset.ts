/**
 * Fluxo de Caixa oficial — entradas/saídas de AR/AP Nomus.
 * FIN-08/FIN-09: com contexto FIN-05 do portfólio, usa agenda efetiva (CR + residual).
 */
import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArReceivedOrSettled,
  resolveFinanceArCustomerKey,
  roundMoney,
  safeRatio,
  startOfLocalDay,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  isFinanceArAllowedInManagementReport,
  isFinanceArOverdueWithoutFiscalDocument,
} from "./financeAccountsReceivableManagement.js";
import {
  classifyFinanceApTitle,
  isFinanceApOpen,
  resolveFinanceApSupplierKey,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import { isFinanceArOverdueRow } from "./financeAccountsReceivableOverdue.js";
import { resolveFinanceApOpenAmount } from "./financeAccountsPayableRules.js";
import { isFinanceApExcludedFromManagement } from "./financeInternalGroupExclusions.js";
import {
  isNomusApStaleForReports,
  resolveEffectiveNomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  isNomusArStaleForReports,
  resolveEffectiveNomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  filterCashFlowApPortfolioRows,
  filterCashFlowApRowsScoped,
  filterCashFlowArPortfolioRows,
  filterCashFlowArRowsScoped,
  type FinanceCashFlowArFilterOptions,
} from "./financeCashFlowRowFilters.js";
import type { FinanceArEffectiveOrderContext } from "./finance/financeAccountsReceivableEffectiveTitles.js";
import type {
  FinanceCashFlowCriticalMovement,
  FinanceCashFlowPartySummary,
} from "./financeCashFlowDashboardTypes.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

export type FinanceCashFlowTraceSource = "NomusAccountsReceivable" | "NomusAccountsPayable";

export type FinanceCashFlowTraceItem = {
  source: FinanceCashFlowTraceSource;
  externalId: number | null;
  documentNumber: string | null;
  companyName: string | null;
  personName: string | null;
  description: string | null;
  dueDate: string | null;
  scheduleDate?: string | null;
  settlementDate?: string | null;
  amountOriginal: number;
  amountRealized: number;
  balanceOpen: number;
  syncedAt: string | null;
  syncCutoff: string | null;
  isFresh: boolean;
  isExcluded: boolean;
  exclusionReason: string | null;
  operationalDate: string | null;
  aggregationDate: string | null;
  usedInBlocks: string[];
  ruleNotes: string[];
};

export type FinanceCashFlowDatasetBlocks = {
  largestExpectedInflows: FinanceCashFlowCriticalMovement[];
  largestExpectedOutflows: FinanceCashFlowCriticalMovement[];
  overdueReceivables: FinanceCashFlowCriticalMovement[];
  overduePayables: FinanceCashFlowCriticalMovement[];
  topReceivableCustomers: FinanceCashFlowPartySummary[];
  topPayableSuppliers: FinanceCashFlowPartySummary[];
  overdueReceivableAmount: number;
  overduePayableAmount: number;
  totalReceivableOpen: number;
  totalPayableOpen: number;
};

export type FinanceCashFlowDataset = {
  filters: FinanceCashFlowDashboardFilters;
  referenceDate: Date;
  arSyncCutoff: NomusArReportSyncCutoff | null;
  apSyncCutoff: NomusApReportSyncCutoff | null;
  arRowsSanitized: FinanceCashFlowArRow[];
  apRowsSanitized: FinanceCashFlowApRow[];
  arPortfolioRows: FinanceCashFlowArRow[];
  apPortfolioRows: FinanceCashFlowApRow[];
  arTrace: FinanceCashFlowTraceItem[];
  apTrace: FinanceCashFlowTraceItem[];
  blocks: FinanceCashFlowDatasetBlocks;
};

export type FinanceCashFlowAuditExclusions = {
  arStale: number;
  arReceivedOrSettled: number;
  arOverdueWithoutFiscalDocument: number;
  arNotAllowedInManagementReport: number;
  apStale: number;
  apIntercompanyOrPurchaseOrder: number;
  apPaidOrSettled: number;
};

export type FinanceCashFlowAuditPayload = {
  filters: FinanceCashFlowDashboardFilters;
  referenceDate: string;
  syncCutoffs: {
    ar: string | null;
    ap: string | null;
  };
  counts: {
    arRaw: number;
    arPortfolio: number;
    arPeriod: number;
    apRaw: number;
    apPortfolio: number;
    apPeriod: number;
  };
  exclusions: FinanceCashFlowAuditExclusions;
  blockTotals: {
    totalReceivableOpen: number;
    totalPayableOpen: number;
    overdueReceivableAmount: number;
    overduePayableAmount: number;
    largestExpectedInflows: number;
    largestExpectedOutflows: number;
    overdueReceivables: number;
    overduePayables: number;
    topReceivableCustomers: number;
    topPayableSuppliers: number;
  };
  traces: {
    overdueReceivables: FinanceCashFlowTraceItem[];
    largestExpectedInflows: FinanceCashFlowTraceItem[];
    topReceivableCustomers: FinanceCashFlowTraceItem[];
    overduePayables: FinanceCashFlowTraceItem[];
    largestExpectedOutflows: FinanceCashFlowTraceItem[];
    topPayableSuppliers: FinanceCashFlowTraceItem[];
  };
};

function toIsoDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

export function isFinanceCashFlowArOpenRow(row: FinanceCashFlowArRow): boolean {
  if (row.suspendCollection === true) return false;
  return !isFinanceArReceivedOrSettled(row);
}

export function isFinanceCashFlowArOverdueRow(
  row: FinanceCashFlowArRow,
  referenceDate: Date
): boolean {
  return isFinanceArOverdueRow(row, referenceDate);
}

export function isFinanceCashFlowApOpenRow(row: FinanceCashFlowApRow): boolean {
  if (row.suspendPayment === true) return false;
  return isFinanceApOpen(row);
}

export function isFinanceCashFlowApOverdueRow(
  row: FinanceCashFlowApRow,
  referenceDate: Date
): boolean {
  if (!isFinanceCashFlowApOpenRow(row)) return false;
  return classifyFinanceApTitle(row, referenceDate) === "overdue";
}

function toCriticalMovement(
  side: "inflow" | "outflow",
  row: FinanceCashFlowArRow | FinanceCashFlowApRow,
  amount: number,
  referenceDate: Date,
  documentLabel: string | null | undefined,
  daysOverdue: number
): FinanceCashFlowCriticalMovement {
  return {
    side,
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: toIsoDate(row.dueDate),
    movementDate: toIsoDate(row.dueDate),
    amount: roundMoney(amount),
    daysOverdue,
    documentLabel: documentLabel ?? undefined,
  };
}

function buildPartySummaries(
  rows: Array<{ key: string; personName: string | null; personCnpj: string | null; amount: number }>,
  limit: number
): FinanceCashFlowPartySummary[] {
  const map = new Map<
    string,
    { personName: string | null; personCnpj: string | null; amount: number; count: number }
  >();
  for (const row of rows) {
    const existing = map.get(row.key);
    if (existing) {
      existing.amount += row.amount;
      existing.count += 1;
    } else {
      map.set(row.key, {
        personName: row.personName,
        personCnpj: row.personCnpj,
        amount: row.amount,
        count: 1,
      });
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((s, r) => s + r.amount, 0);
  return sorted.slice(0, limit).map((r) => ({
    personName: r.personName,
    personCnpj: r.personCnpj,
    amount: roundMoney(r.amount),
    titlesCount: r.count,
    percentOfTotal: roundMoney(safeRatio(r.amount, total) * 100),
  }));
}

function computeArDaysOverdue(row: FinanceCashFlowArRow, referenceDate: Date): number {
  return computeDaysOverdue(row.dueDate, referenceDate);
}

function computeApDaysOverdue(row: FinanceCashFlowApRow, referenceDate: Date): number {
  return computeDaysOverdue(getAccountsPayableOperationalDueDate(row), referenceDate);
}

function buildBlocksFromPortfolio(
  arPortfolioRows: FinanceCashFlowArRow[],
  apPortfolioRows: FinanceCashFlowApRow[],
  referenceDate: Date,
  officialTotals?: {
    ar?: Pick<
      FinanceCashFlowDatasetBlocks,
      "totalReceivableOpen" | "overdueReceivableAmount"
    >;
    ap?: Pick<
      FinanceCashFlowDatasetBlocks,
      "totalPayableOpen" | "overduePayableAmount"
    >;
  }
): FinanceCashFlowDatasetBlocks {
  const ref = startOfLocalDay(referenceDate);
  const projectedInflows: FinanceCashFlowCriticalMovement[] = [];
  const projectedOutflows: FinanceCashFlowCriticalMovement[] = [];
  const overdueReceivables: FinanceCashFlowCriticalMovement[] = [];
  const overduePayables: FinanceCashFlowCriticalMovement[] = [];

  let overdueReceivableAmount = 0;
  let overduePayableAmount = 0;
  let totalReceivableOpen = 0;
  let totalPayableOpen = 0;

  const customerRows: Array<{
    key: string;
    personName: string | null;
    personCnpj: string | null;
    amount: number;
  }> = [];
  const supplierRows: Array<{
    key: string;
    personName: string | null;
    personCnpj: string | null;
    amount: number;
  }> = [];

  for (const row of arPortfolioRows) {
    if (!isFinanceCashFlowArOpenRow(row)) continue;
    const balance = roundMoney(row.balanceReceivable);
    if (balance <= 0) continue;

    totalReceivableOpen += balance;
    customerRows.push({
      key: resolveFinanceArCustomerKey(row),
      personName: row.personName,
      personCnpj: row.personCnpj,
      amount: balance,
    });

    projectedInflows.push(
      toCriticalMovement(
        "inflow",
        row,
        balance,
        referenceDate,
        row.sourceInvoiceNumber,
        classifyFinanceArTitle(row, referenceDate) === "overdue"
          ? computeArDaysOverdue(row, referenceDate)
          : 0
      )
    );

    if (isFinanceCashFlowArOverdueRow(row, referenceDate)) {
      const days = computeArDaysOverdue(row, referenceDate);
      overdueReceivableAmount += balance;
      overdueReceivables.push(
        toCriticalMovement("inflow", row, balance, referenceDate, row.sourceInvoiceNumber, days)
      );
    }
  }

  for (const row of apPortfolioRows) {
    if (!isFinanceCashFlowApOpenRow(row)) continue;
    const openAmount = roundMoney(resolveFinanceApOpenAmount(row));
    if (openAmount <= 0) continue;

    totalPayableOpen += openAmount;
    supplierRows.push({
      key: resolveFinanceApSupplierKey(row),
      personName: row.personName,
      personCnpj: row.personCnpj,
      amount: openAmount,
    });

    projectedOutflows.push(
      toCriticalMovement(
        "outflow",
        row,
        openAmount,
        referenceDate,
        row.documentNumber,
        classifyFinanceApTitle(row, referenceDate) === "overdue"
          ? computeApDaysOverdue(row, referenceDate)
          : 0
      )
    );

    if (isFinanceCashFlowApOverdueRow(row, referenceDate)) {
      const days = computeApDaysOverdue(row, referenceDate);
      overduePayableAmount += openAmount;
      overduePayables.push(
        toCriticalMovement("outflow", row, openAmount, referenceDate, row.documentNumber, days)
      );
    }
  }

  const sortDesc = (a: FinanceCashFlowCriticalMovement, b: FinanceCashFlowCriticalMovement) =>
    b.amount - a.amount;

  return {
    largestExpectedInflows: projectedInflows.sort(sortDesc).slice(0, 10),
    largestExpectedOutflows: projectedOutflows.sort(sortDesc).slice(0, 10),
    overdueReceivables: overdueReceivables.sort(sortDesc).slice(0, 10),
    overduePayables: overduePayables.sort(sortDesc).slice(0, 10),
    topReceivableCustomers: buildPartySummaries(customerRows, 10),
    topPayableSuppliers: buildPartySummaries(supplierRows, 10),
    overdueReceivableAmount: roundMoney(
      officialTotals?.ar?.overdueReceivableAmount ?? overdueReceivableAmount
    ),
    overduePayableAmount: roundMoney(
      officialTotals?.ap?.overduePayableAmount ?? overduePayableAmount
    ),
    totalReceivableOpen: roundMoney(
      officialTotals?.ar?.totalReceivableOpen ?? totalReceivableOpen
    ),
    totalPayableOpen: roundMoney(officialTotals?.ap?.totalPayableOpen ?? totalPayableOpen),
  };
}

function traceForArRow(
  row: FinanceCashFlowArRow,
  inPortfolio: boolean,
  inPeriod: boolean,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null,
  blocks: FinanceCashFlowDatasetBlocks
): FinanceCashFlowTraceItem {
  const usedInBlocks: string[] = [];
  const ruleNotes: string[] = [];

  if (!inPortfolio) {
    ruleNotes.push("excluído do portfólio AR (filtro/freshness/fantasma/stale/deduplicação)");
  }
  if (inPortfolio && !inPeriod) {
    ruleNotes.push("no portfólio, fora do recorte de período do fluxo");
  }
  if (isFinanceArReceivedOrSettled(row)) {
    ruleNotes.push("recebido/baixado — não entra em aberto/vencido");
  }
  if (isFinanceCashFlowArOpenRow(row)) {
    ruleNotes.push("saldo em aberto elegível");
  }
  if (isFinanceCashFlowArOverdueRow(row, referenceDate)) {
    ruleNotes.push("vencido em aberto");
  }
  if (isFinanceArOverdueWithoutFiscalDocument(row, referenceDate)) {
    ruleNotes.push("vencido sem NF — excluído de vencidos/portfólio");
  }

  const matchBlock = (list: FinanceCashFlowCriticalMovement[], block: string) => {
    if (list.some((m) => m.externalId === row.externalId)) usedInBlocks.push(block);
  };
  matchBlock(blocks.largestExpectedInflows, "largestExpectedInflows");
  matchBlock(blocks.overdueReceivables, "overdueReceivables");
  if (
    blocks.topReceivableCustomers.some(
      (c) =>
        (c.personCnpj && c.personCnpj === row.personCnpj) ||
        (c.personName && c.personName === row.personName)
    ) &&
    isFinanceCashFlowArOpenRow(row)
  ) {
    usedInBlocks.push("topReceivableCustomers");
  }

  return {
    source: "NomusAccountsReceivable",
    externalId: row.externalId,
    documentNumber: row.sourceInvoiceNumber,
    companyName: row.companyName,
    personName: row.personName,
    description: row.description ?? null,
    dueDate: toIsoDate(row.dueDate),
    settlementDate: toIsoDate(row.settlementDate),
    amountOriginal: roundMoney(row.amountReceivable),
    amountRealized: roundMoney(row.amountReceived),
    balanceOpen: roundMoney(row.balanceReceivable),
    syncedAt: toIsoDate(row.syncedAt),
    syncCutoff: syncCutoff?.minEligibleSyncedAt?.toISOString() ?? null,
    isFresh: inPortfolio,
    isExcluded: !inPortfolio,
    exclusionReason: inPortfolio ? null : "fora do portfólio saneado",
    operationalDate: toIsoDate(row.dueDate),
    aggregationDate: toIsoDate(row.dueDate),
    usedInBlocks,
    ruleNotes,
  };
}

function traceForApRow(
  row: FinanceCashFlowApRow,
  inPortfolio: boolean,
  inPeriod: boolean,
  referenceDate: Date,
  syncCutoff: NomusApReportSyncCutoff | null,
  blocks: FinanceCashFlowDatasetBlocks
): FinanceCashFlowTraceItem {
  const usedInBlocks: string[] = [];
  const ruleNotes: string[] = [];
  const operationalDate = getAccountsPayableOperationalDueDate(row);

  if (!inPortfolio) {
    ruleNotes.push("excluído do portfólio AP gerencial (stale/intercompany/pedido de compra/filtro)");
  }
  if (inPortfolio && !inPeriod) {
    ruleNotes.push("no portfólio, fora do recorte de período do fluxo");
  }
  if (!isFinanceApOpen(row)) {
    ruleNotes.push("pago/baixado — não entra em aberto/vencido");
  }
  if (isFinanceCashFlowApOpenRow(row)) {
    ruleNotes.push("saldo em aberto elegível");
  }
  if (isFinanceCashFlowApOverdueRow(row, referenceDate)) {
    ruleNotes.push("vencido operacionalmente");
  }
  if (isFinanceApExcludedFromManagement(row)) {
    ruleNotes.push("intercompany ou pedido de compra/type=2 — excluído da agenda gerencial");
  }

  const matchBlock = (list: FinanceCashFlowCriticalMovement[], block: string) => {
    if (list.some((m) => m.externalId === row.externalId)) usedInBlocks.push(block);
  };
  matchBlock(blocks.largestExpectedOutflows, "largestExpectedOutflows");
  matchBlock(blocks.overduePayables, "overduePayables");
  if (
    blocks.topPayableSuppliers.some(
      (c) =>
        (c.personCnpj && c.personCnpj === row.personCnpj) ||
        (c.personName && c.personName === row.personName)
    ) &&
    isFinanceCashFlowApOpenRow(row)
  ) {
    usedInBlocks.push("topPayableSuppliers");
  }

  return {
    source: "NomusAccountsPayable",
    externalId: row.externalId,
    documentNumber: row.documentNumber,
    companyName: row.companyName,
    personName: row.personName,
    description: row.description ?? null,
    dueDate: toIsoDate(row.dueDate),
    scheduleDate: toIsoDate(row.scheduleDate),
    settlementDate: toIsoDate(row.settlementDate ?? row.paymentDate),
    amountOriginal: roundMoney(row.amountPayable),
    amountRealized: roundMoney(row.amountPaid),
    balanceOpen: roundMoney(resolveFinanceApOpenAmount(row)),
    syncedAt: toIsoDate(row.syncedAt),
    syncCutoff: syncCutoff?.minEligibleSyncedAt?.toISOString() ?? null,
    isFresh: inPortfolio,
    isExcluded: !inPortfolio,
    exclusionReason: inPortfolio ? null : "fora do portfólio saneado",
    operationalDate: toIsoDate(operationalDate),
    aggregationDate: toIsoDate(operationalDate),
    usedInBlocks,
    ruleNotes,
  };
}

export type FinanceCashFlowDatasetOptions = FinanceCashFlowArFilterOptions & {
  /** Totais AR oficiais do motor — sobrescreve somatório do loop de blocos. */
  officialArBlockTotals?: Pick<
    FinanceCashFlowDatasetBlocks,
    "totalReceivableOpen" | "overdueReceivableAmount"
  >;
  /** Totais AP oficiais do motor — sobrescreve somatório do loop de blocos. */
  officialApBlockTotals?: Pick<
    FinanceCashFlowDatasetBlocks,
    "totalPayableOpen" | "overduePayableAmount"
  >;
};

export type { FinanceArEffectiveOrderContext };

export function buildFinanceCashFlowDataset(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date = new Date(),
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  options?: FinanceCashFlowDatasetOptions
): FinanceCashFlowDataset {
  const arFilterOptions: FinanceCashFlowArFilterOptions | undefined =
    options?.orderContexts !== undefined || options?.nfeOrderLinks !== undefined
      ? {
          orderContexts: options.orderContexts ?? [],
          nfeOrderLinks: options.nfeOrderLinks,
        }
      : undefined;
  const arPortfolioRows = filterCashFlowArPortfolioRows(
    arRows,
    filters,
    arFilters,
    referenceDate,
    arSyncCutoff,
    arFilterOptions
  );
  const apPortfolioRows = filterCashFlowApPortfolioRows(
    apRows,
    filters,
    apFilters,
    referenceDate,
    apSyncCutoff
  );
  const arRowsSanitized = filterCashFlowArRowsScoped(
    arRows,
    filters,
    arFilters,
    referenceDate,
    arSyncCutoff,
    arFilterOptions
  );
  const apRowsSanitized = filterCashFlowApRowsScoped(
    apRows,
    filters,
    apFilters,
    referenceDate,
    apSyncCutoff
  );

  const blocks = buildBlocksFromPortfolio(arPortfolioRows, apPortfolioRows, referenceDate, {
    ar: options?.officialArBlockTotals,
    ap: options?.officialApBlockTotals,
  });

  const arPortfolioIds = new Set(arPortfolioRows.map((r) => r.externalId));
  const arPeriodIds = new Set(arRowsSanitized.map((r) => r.externalId));
  const apPortfolioIds = new Set(apPortfolioRows.map((r) => r.externalId));
  const apPeriodIds = new Set(apRowsSanitized.map((r) => r.externalId));

  const arTrace = arRows.map((row) =>
    traceForArRow(
      row,
      arPortfolioIds.has(row.externalId),
      arPeriodIds.has(row.externalId),
      referenceDate,
      arSyncCutoff ?? null,
      blocks
    )
  );
  const apTrace = apRows.map((row) =>
    traceForApRow(
      row,
      apPortfolioIds.has(row.externalId),
      apPeriodIds.has(row.externalId),
      referenceDate,
      apSyncCutoff ?? null,
      blocks
    )
  );

  return {
    filters,
    referenceDate,
    arSyncCutoff: arSyncCutoff ?? null,
    apSyncCutoff: apSyncCutoff ?? null,
    arRowsSanitized,
    apRowsSanitized,
    arPortfolioRows,
    apPortfolioRows,
    arTrace,
    apTrace,
    blocks,
  };
}

export function countCashFlowAuditExclusions(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowAuditExclusions {
  const arEffectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(arRows, arSyncCutoff);
  const apEffectiveCutoff = resolveEffectiveNomusApReportSyncCutoff(apRows, apSyncCutoff);

  let arStale = 0;
  let arReceivedOrSettled = 0;
  let arOverdueWithoutFiscalDocument = 0;
  let arNotAllowedInManagementReport = 0;
  let apStale = 0;
  let apIntercompanyOrPurchaseOrder = 0;
  let apPaidOrSettled = 0;

  for (const row of arRows) {
    if (isNomusArStaleForReports(row, arEffectiveCutoff)) arStale += 1;
    if (isFinanceArReceivedOrSettled(row)) arReceivedOrSettled += 1;
    if (isFinanceArOverdueWithoutFiscalDocument(row, referenceDate)) {
      arOverdueWithoutFiscalDocument += 1;
    }
    if (!isFinanceArAllowedInManagementReport(row, referenceDate)) {
      arNotAllowedInManagementReport += 1;
    }
  }

  for (const row of apRows) {
    if (isNomusApStaleForReports(row, apEffectiveCutoff)) apStale += 1;
    if (isFinanceApExcludedFromManagement(row)) apIntercompanyOrPurchaseOrder += 1;
    if (!isFinanceApOpen(row)) apPaidOrSettled += 1;
  }

  return {
    arStale,
    arReceivedOrSettled,
    arOverdueWithoutFiscalDocument,
    arNotAllowedInManagementReport,
    apStale,
    apIntercompanyOrPurchaseOrder,
    apPaidOrSettled,
  };
}

export function buildFinanceCashFlowAuditPayload(
  dataset: FinanceCashFlowDataset,
  arRawCount: number,
  apRawCount: number,
  arRows: FinanceCashFlowArRow[] = [],
  apRows: FinanceCashFlowApRow[] = []
): FinanceCashFlowAuditPayload {
  const { blocks, arTrace, apTrace } = dataset;
  const traceUsed = (block: string) =>
    [...arTrace, ...apTrace].filter((t) => t.usedInBlocks.includes(block));

  const sumMovements = (items: FinanceCashFlowCriticalMovement[]) =>
    roundMoney(items.reduce((s, r) => s + r.amount, 0));
  const sumParties = (items: FinanceCashFlowPartySummary[]) =>
    roundMoney(items.reduce((s, r) => s + r.amount, 0));

  return {
    filters: dataset.filters,
    referenceDate: dataset.referenceDate.toISOString(),
    syncCutoffs: {
      ar: dataset.arSyncCutoff?.minEligibleSyncedAt?.toISOString() ?? null,
      ap: dataset.apSyncCutoff?.minEligibleSyncedAt?.toISOString() ?? null,
    },
    counts: {
      arRaw: arRawCount,
      arPortfolio: dataset.arPortfolioRows.length,
      arPeriod: dataset.arRowsSanitized.length,
      apRaw: apRawCount,
      apPortfolio: dataset.apPortfolioRows.length,
      apPeriod: dataset.apRowsSanitized.length,
    },
    exclusions: countCashFlowAuditExclusions(
      arRows,
      apRows,
      dataset.referenceDate,
      dataset.arSyncCutoff,
      dataset.apSyncCutoff
    ),
    blockTotals: {
      totalReceivableOpen: blocks.totalReceivableOpen,
      totalPayableOpen: blocks.totalPayableOpen,
      overdueReceivableAmount: blocks.overdueReceivableAmount,
      overduePayableAmount: blocks.overduePayableAmount,
      largestExpectedInflows: sumMovements(blocks.largestExpectedInflows),
      largestExpectedOutflows: sumMovements(blocks.largestExpectedOutflows),
      overdueReceivables: sumMovements(blocks.overdueReceivables),
      overduePayables: sumMovements(blocks.overduePayables),
      topReceivableCustomers: sumParties(blocks.topReceivableCustomers),
      topPayableSuppliers: sumParties(blocks.topPayableSuppliers),
    },
    traces: {
      overdueReceivables: traceUsed("overdueReceivables"),
      largestExpectedInflows: traceUsed("largestExpectedInflows"),
      topReceivableCustomers: traceUsed("topReceivableCustomers"),
      overduePayables: traceUsed("overduePayables"),
      largestExpectedOutflows: traceUsed("largestExpectedOutflows"),
      topPayableSuppliers: traceUsed("topPayableSuppliers"),
    },
  };
}

/** Soma das linhas rastreadas em um bloco — deve bater com o total exibido. */
export function sumCashFlowTraceBlockAmount(traces: FinanceCashFlowTraceItem[]): number {
  return roundMoney(
    traces.reduce((sum, row) => {
      if (row.isExcluded || !row.usedInBlocks.length) return sum;
      return sum + row.balanceOpen;
    }, 0)
  );
}
