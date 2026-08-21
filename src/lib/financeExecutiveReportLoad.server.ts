/**
 * Cargas compartilhadas do Relatório Presidencial — uma população, um enrich FIN-05.
 * Não altera regra financeira; só elimina leituras/enriches duplicados no mesmo request.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
  resolveFinanceApDueDateBounds,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "./financeAccountsPayableTitles.js";
import {
  buildFinanceArPrismaWhere,
  mapPrismaRowToFinanceArDashboardRow,
  resolveFinanceArDueDateBounds,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { FINANCE_AR_TITLE_SELECT } from "./financeAccountsReceivableTitles.js";
import { isFinanceArExcludedByCancelledSalesOrder } from "./financeArCancelledSalesOrderExclusion.js";
import {
  loadFinanceArCancelledSalesOrderExclusionIndex,
  type FinanceArCancelledSalesOrderExclusionIndex,
} from "./financeArCancelledSalesOrderExclusion.server.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
  toApLoadFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { buildCashFlowApPrismaWhere } from "./financeCashFlowRowFilters.js";
import { enrichFinanceCashFlowArLoadBundle } from "./finance/financeCashFlowEffectiveAr.server.js";
import type { FinanceArEffectiveOrderContext } from "./finance/financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./finance/financeArOperationalPortfolio.js";
import {
  resolveNomusApReportSyncCutoffFromPrisma,
  type NomusApReportSyncCutoff,
} from "./financeNomusApReportFreshness.js";
import {
  resolveNomusArReportSyncCutoffFromPrisma,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";
import { prisma as defaultPrisma } from "./prisma.js";

export type ExecutiveReportLoadCall = {
  kind: "arYear" | "apYear" | "arAllYears" | "apAllYears" | "enrich";
  fingerprint: string;
};

const trackers = new Set<ExecutiveReportLoadCall[]>();

export function startExecutiveReportLoadTracker(): {
  getCalls: () => ExecutiveReportLoadCall[];
  stop: () => ExecutiveReportLoadCall[];
} {
  const calls: ExecutiveReportLoadCall[] = [];
  trackers.add(calls);
  return {
    getCalls: () => [...calls],
    stop: () => {
      trackers.delete(calls);
      return calls;
    },
  };
}

function noteLoadCall(call: ExecutiveReportLoadCall): void {
  if (trackers.size === 0) return;
  for (const tracker of trackers) tracker.push(call);
}

function fingerprintFilters(filters: unknown): string {
  return JSON.stringify(filters ?? null);
}

function dueDateInBounds(
  dueDate: Date | null | undefined,
  from: Date | null,
  toExclusive: Date | null
): boolean {
  if (!dueDate) return false;
  const t = startOfLocalDay(dueDate).getTime();
  if (from != null && t < from.getTime()) return false;
  if (toExclusive != null && t >= toExclusive.getTime()) return false;
  return true;
}

/**
 * Recorta a carteira anual ao vencimento do período — mesma população do load
 * projected BASE (year+month) sem segundo enrich FIN-05.
 */
export function sliceCashFlowRowsToDuePeriod(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters
): { arRows: FinanceCashFlowArRow[]; apRows: FinanceCashFlowApRow[] } {
  const arBounds = resolveFinanceArDueDateBounds({
    year: filters.year,
    month: filters.month,
  });
  const apBounds = resolveFinanceApDueDateBounds({
    year: filters.year,
    month: filters.month,
  });
  if (arBounds.empty && apBounds.empty) {
    return { arRows: [], apRows: [] };
  }
  return {
    arRows: arBounds.empty
      ? []
      : arRows.filter((row) => dueDateInBounds(row.dueDate, arBounds.from, arBounds.toExclusive)),
    apRows: apBounds.empty
      ? []
      : apRows.filter((row) => dueDateInBounds(row.dueDate, apBounds.from, apBounds.toExclusive)),
  };
}

export type ExecutiveReportSharedCutoffs = {
  arSyncCutoff: NomusArReportSyncCutoff | null;
  apSyncCutoff: NomusApReportSyncCutoff | null;
  cancelledExclusion: FinanceArCancelledSalesOrderExclusionIndex;
};

export async function resolveExecutiveReportSharedCutoffs(
  db: Pick<
    PrismaClient,
    "nomusAccountsReceivable" | "nomusAccountsPayable" | "salesOrder" | "salesOrderNfeLink"
  > = defaultPrisma
): Promise<ExecutiveReportSharedCutoffs> {
  const [arSyncCutoff, apSyncCutoff, cancelledExclusion] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(db),
    resolveNomusApReportSyncCutoffFromPrisma(db),
    loadFinanceArCancelledSalesOrderExclusionIndex(db),
  ]);
  return { arSyncCutoff, apSyncCutoff, cancelledExclusion };
}

export async function loadExecutiveReportArRows(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  shared: Pick<ExecutiveReportSharedCutoffs, "arSyncCutoff" | "cancelledExclusion">,
  kind: "arYear" | "arAllYears"
): Promise<FinanceArDashboardRow[]> {
  noteLoadCall({
    kind,
    fingerprint: fingerprintFilters(filters),
  });
  const where = buildFinanceArPrismaWhere(filters, referenceDate, shared.arSyncCutoff);
  const rawRows = await db.nomusAccountsReceivable.findMany({
    where,
    select: FINANCE_AR_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return rawRows
    .map(mapPrismaRowToFinanceArDashboardRow)
    .filter((row) => !isFinanceArExcludedByCancelledSalesOrder(row, shared.cancelledExclusion));
}

export async function loadExecutiveReportApRows(
  db: Pick<PrismaClient, "nomusAccountsPayable">,
  filters: FinanceApDashboardFilters,
  shared: Pick<ExecutiveReportSharedCutoffs, "apSyncCutoff">,
  kind: "apYear" | "apAllYears"
): Promise<FinanceApDashboardRow[]> {
  noteLoadCall({
    kind,
    fingerprint: fingerprintFilters(filters),
  });
  const where = buildFinanceApPrismaWhere(filters, shared.apSyncCutoff);
  const rows = await db.nomusAccountsPayable.findMany({
    where,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return rows.map(mapPrismaRowToFinanceApDashboardRow);
}

export async function loadExecutiveReportCashFlowApRows(
  db: Pick<PrismaClient, "nomusAccountsPayable">,
  cashFlowFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  shared: Pick<ExecutiveReportSharedCutoffs, "apSyncCutoff">,
  kind: "apYear" | "apAllYears"
): Promise<FinanceCashFlowApRow[]> {
  noteLoadCall({
    kind,
    fingerprint: `cf:${fingerprintFilters(cashFlowFilters)}`,
  });
  const apFilters = toApLoadFilters(cashFlowFilters);
  const apWhere = buildCashFlowApPrismaWhere(
    cashFlowFilters,
    apFilters,
    referenceDate,
    shared.apSyncCutoff
  );
  const apPrisma = await db.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_CASH_FLOW_AP_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return apPrisma.map(mapPrismaRowToFinanceCashFlowApRow);
}

export type ExecutiveReportYearScopedBundle = {
  arRows: FinanceCashFlowArRow[];
  apRows: FinanceCashFlowApRow[];
  arDashboardRows: FinanceArDashboardRow[];
  apDashboardRows: FinanceApDashboardRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  apSyncCutoff: NomusApReportSyncCutoff | null;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
};

export type ExecutiveReportAllYearsBundle = {
  arRows: FinanceCashFlowArRow[];
  apRows: FinanceCashFlowApRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  apSyncCutoff: NomusApReportSyncCutoff | null;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
};

/**
 * Carteira do ano (AR/AP oficiais + CF anual/período) — um enrich FIN-05.
 * AP usa o where do CF anual (projected ≡ portfolio AP com ano); uma query alimenta KPIs e CF.
 */
export async function loadExecutiveReportYearScopedBundle(
  db: PrismaClient,
  input: {
    arPortfolioFilters: FinanceArDashboardFilters;
    cashFlowAnnualFilters: FinanceCashFlowDashboardFilters;
    referenceDate: Date;
    shared: ExecutiveReportSharedCutoffs;
  }
): Promise<ExecutiveReportYearScopedBundle> {
  const { arPortfolioFilters, cashFlowAnnualFilters, referenceDate, shared } = input;

  const [arDashboardRows, apCashFlowRows] = await Promise.all([
    loadExecutiveReportArRows(db, arPortfolioFilters, referenceDate, shared, "arYear"),
    loadExecutiveReportCashFlowApRows(db, cashFlowAnnualFilters, referenceDate, shared, "apYear"),
  ]);

  const arRows = arDashboardRows as FinanceCashFlowArRow[];
  const apDashboardRows = apCashFlowRows as FinanceApDashboardRow[];
  noteLoadCall({ kind: "enrich", fingerprint: "year-scoped" });
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    db,
    arRows,
    referenceDate,
    {
      customerName: cashFlowAnnualFilters.customerName,
      personCnpj: cashFlowAnnualFilters.personCnpj,
    }
  );

  return {
    arRows,
    apRows: apCashFlowRows,
    arDashboardRows,
    apDashboardRows,
    arSyncCutoff: shared.arSyncCutoff,
    apSyncCutoff: shared.apSyncCutoff,
    orderContexts,
    nfeOrderLinks,
  };
}

/**
 * Carteira all-years (comparativo anual + radar) — um enrich FIN-05.
 * Filtros de empresa/escopo/NF vêm do cashFlowFilters do relatório.
 */
export async function loadExecutiveReportAllYearsBundle(
  db: PrismaClient,
  cashFlowFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  shared: ExecutiveReportSharedCutoffs
): Promise<ExecutiveReportAllYearsBundle> {
  const arFilters = toCashFlowPortfolioArFilters(cashFlowFilters);
  const apFilters = toCashFlowPortfolioApFilters(cashFlowFilters);

  const [arManagementRows, apPrisma] = await Promise.all([
    loadExecutiveReportArRows(db, arFilters, referenceDate, shared, "arAllYears"),
    (async () => {
      noteLoadCall({
        kind: "apAllYears",
        fingerprint: fingerprintFilters(apFilters),
      });
      const where = buildFinanceApPrismaWhere(apFilters, shared.apSyncCutoff);
      return db.nomusAccountsPayable.findMany({
        where,
        select: FINANCE_CASH_FLOW_AP_SELECT,
        orderBy: { dueDate: "asc" },
      });
    })(),
  ]);

  const arRows = arManagementRows as FinanceCashFlowArRow[];
  noteLoadCall({ kind: "enrich", fingerprint: "all-years" });
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    db,
    arRows,
    referenceDate,
    {
      customerName: cashFlowFilters.customerName,
      personCnpj: cashFlowFilters.personCnpj,
    }
  );

  return {
    arRows,
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff: shared.arSyncCutoff,
    apSyncCutoff: shared.apSyncCutoff,
    orderContexts,
    nfeOrderLinks,
  };
}
