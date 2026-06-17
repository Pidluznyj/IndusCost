/**
 * Financeiro do cliente — Contas a Receber canônico gerencial.
 */

import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  filterFinanceArManagementReportRows,
  FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
  hasFinanceArSourceInvoice,
  isFinanceArOverdueWithoutFiscalDocument,
  isFinanceArReceivedOrSettled,
  roundMoney,
  startOfLocalDay,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  isFinanceArExcludedFromReports,
  isNomusArStaleForReports,
  resolveEffectiveNomusArReportSyncCutoff,
  type NomusArReportSyncCutoff,
} from "@/src/lib/financeNomusArReportFreshness.js";
import { normalizeCustomerDocument } from "@/src/lib/customerCommercialSalesOrderView.js";
import {
  cnpjMatchesArRow,
  toIsoDateOnly,
} from "@/src/lib/customerIntelligenceUtils.js";
import type {
  CustomerIntelligenceFinancial,
  CustomerIntelligenceFinancialAgingBucket,
  CustomerIntelligenceFinancialTitle,
  CustomerIntelligenceFinancialTitleStatus,
} from "@/src/lib/customerIntelligenceTypes.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const AGING_BUCKET_DEFS = [
  { key: "upcoming", label: "A vencer" },
  { key: "dueToday", label: "Vence hoje" },
  { key: "overdue1to7", label: "1 a 7 dias vencido" },
  { key: "overdue8to15", label: "8 a 15 dias vencido" },
  { key: "overdue16to30", label: "16 a 30 dias vencido" },
  { key: "overdue31to60", label: "31 a 60 dias vencido" },
  { key: "overdue61to90", label: "61 a 90 dias vencido" },
  { key: "overdue90plus", label: "Acima de 90 dias" },
] as const;

export const CUSTOMER_INTELLIGENCE_FINANCIAL_OPEN_TITLES_LIMIT = 20;
export const CUSTOMER_INTELLIGENCE_FINANCIAL_PAYMENT_HISTORY_LIMIT = 15;

function assignAgingBucketKey(dueDate: Date, today: Date): string {
  const due = startOfLocalDay(dueDate);
  const t = startOfLocalDay(today);
  const diffDays = Math.floor((due.getTime() - t.getTime()) / MS_PER_DAY);
  if (diffDays > 0) return "upcoming";
  if (diffDays === 0) return "dueToday";
  const overdueDays = -diffDays;
  if (overdueDays <= 7) return "overdue1to7";
  if (overdueDays <= 15) return "overdue8to15";
  if (overdueDays <= 30) return "overdue16to30";
  if (overdueDays <= 60) return "overdue31to60";
  if (overdueDays <= 90) return "overdue61to90";
  return "overdue90plus";
}

function mapTitleStatus(
  status: ReturnType<typeof classifyFinanceArTitle>
): CustomerIntelligenceFinancialTitleStatus {
  return status;
}

function toFinancialTitle(
  row: FinanceArDashboardRow,
  referenceDate: Date
): CustomerIntelligenceFinancialTitle {
  const status = classifyFinanceArTitle(row, referenceDate);
  const hasInvoice = hasFinanceArSourceInvoice(row);
  return {
    externalId: row.externalId,
    description: row.description,
    dueDate: row.dueDate?.toISOString() ?? null,
    balanceReceivable: roundMoney(row.balanceReceivable),
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    daysOverdue: computeDaysOverdue(row.dueDate, referenceDate),
    status: mapTitleStatus(status),
    isForecast: status === "upcoming" && !hasInvoice,
  };
}

function emptyFinancial(linkedByCnpj: boolean): CustomerIntelligenceFinancial {
  const fiscalNote = FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE;
  return {
    receivableOpenAmount: linkedByCnpj ? 0 : null,
    overdueAmount: linkedByCnpj ? 0 : null,
    upcomingAmount: linkedByCnpj ? 0 : null,
    openTitlesCount: linkedByCnpj ? 0 : null,
    overdueTitlesCount: linkedByCnpj ? 0 : null,
    maxDaysOverdue: linkedByCnpj ? 0 : null,
    averageDaysOverdue: linkedByCnpj ? 0 : null,
    nextDueDate: null,
    agingBuckets: AGING_BUCKET_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      amount: 0,
      count: 0,
    })),
    openTitles: [],
    overdueTitles: [],
    paymentHistory: [],
    dataQuality: {
      linkedByCnpj,
      linkMethod: linkedByCnpj ? "cnpj" : "none",
      warnings: linkedByCnpj
        ? []
        : ["Financeiro (AR) não vinculado — CNPJ do cliente ausente ou inválido."],
      staleExcludedCount: 0,
      overdueWithoutFiscalExcludedCount: 0,
      syncCutoffAt: null,
      fiscalBackingNote: fiscalNote,
    },
    linkedByCnpj,
    financialStatus: linkedByCnpj ? "no_titles" : "unlinked",
    riskAlert: null,
  };
}

export function filterCustomerIntelligenceArRowsByCustomer(
  rows: FinanceArDashboardRow[],
  customerTaxId: string | null | undefined
): FinanceArDashboardRow[] {
  return rows.filter((row) => cnpjMatchesArRow(customerTaxId, row.personCnpj));
}

export function countCustomerArSanitizationExclusions(
  customerRows: FinanceArDashboardRow[],
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null
): { staleExcludedCount: number; overdueWithoutFiscalExcludedCount: number } {
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(customerRows, syncCutoff);
  let staleExcludedCount = 0;
  let overdueWithoutFiscalExcludedCount = 0;

  for (const row of customerRows) {
    if (isFinanceArReceivedOrSettled(row)) continue;
    if (row.balanceReceivable <= 0) continue;

    if (isNomusArStaleForReports(row, effectiveCutoff) || isFinanceArExcludedFromReports(row, effectiveCutoff)) {
      staleExcludedCount += 1;
      continue;
    }

    if (isFinanceArOverdueWithoutFiscalDocument(row, referenceDate)) {
      overdueWithoutFiscalExcludedCount += 1;
    }
  }

  return { staleExcludedCount, overdueWithoutFiscalExcludedCount };
}

export function buildCustomerIntelligenceFinancial(input: {
  customerTaxId: string | null | undefined;
  arRows: FinanceArDashboardRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  referenceDate: Date;
}): CustomerIntelligenceFinancial {
  const customerDoc = normalizeCustomerDocument(input.customerTaxId);
  const linkedByCnpj = customerDoc.length > 0;

  if (!linkedByCnpj) {
    return emptyFinancial(false);
  }

  const customerRows = filterCustomerIntelligenceArRowsByCustomer(input.arRows, input.customerTaxId);
  if (customerRows.length === 0) {
    const base = emptyFinancial(true);
    base.dataQuality.warnings.push(
      "Nenhum título de Contas a Receber encontrado para o CNPJ do cliente."
    );
    base.dataQuality.syncCutoffAt = input.arSyncCutoff?.maxSyncedAt.toISOString() ?? null;
    return base;
  }

  const syncCutoff = resolveEffectiveNomusArReportSyncCutoff(customerRows, input.arSyncCutoff);
  const exclusions = countCustomerArSanitizationExclusions(
    customerRows,
    input.referenceDate,
    syncCutoff
  );

  const managedRows = filterFinanceArManagementReportRows(
    customerRows,
    { status: "all" },
    input.referenceDate,
    syncCutoff
  );

  const today = startOfLocalDay(input.referenceDate);
  let receivableOpenAmount = 0;
  let overdueAmount = 0;
  let upcomingAmount = 0;
  let openTitlesCount = 0;
  let overdueTitlesCount = 0;
  let maxDaysOverdue = 0;
  let avgDaysOverdueWeighted = 0;
  let avgDaysOverdueBalance = 0;
  let nextDueDate: Date | null = null;

  const agingAcc = new Map<string, { amount: number; count: number }>();
  for (const def of AGING_BUCKET_DEFS) {
    agingAcc.set(def.key, { amount: 0, count: 0 });
  }

  const openTitleRows: CustomerIntelligenceFinancialTitle[] = [];
  const overdueTitleRows: CustomerIntelligenceFinancialTitle[] = [];

  for (const row of managedRows) {
    if (isFinanceArReceivedOrSettled(row)) continue;
    const balance = roundMoney(row.balanceReceivable);
    if (balance <= 0) continue;

    const status = classifyFinanceArTitle(row, input.referenceDate);
    if (status === "suspended" || status === "unknown") continue;

    receivableOpenAmount += balance;
    openTitlesCount += 1;

    const title = toFinancialTitle(row, input.referenceDate);
    openTitleRows.push(title);

    if (row.dueDate) {
      const due = startOfLocalDay(row.dueDate);
      if (due >= today && (nextDueDate == null || due < startOfLocalDay(nextDueDate))) {
        nextDueDate = row.dueDate;
      }
      const bucketKey = assignAgingBucketKey(row.dueDate, today);
      const bucket = agingAcc.get(bucketKey)!;
      bucket.amount += balance;
      bucket.count += 1;
    }

    if (status === "overdue") {
      overdueAmount += balance;
      overdueTitlesCount += 1;
      overdueTitleRows.push(title);
      const days = computeDaysOverdue(row.dueDate, input.referenceDate);
      if (days > maxDaysOverdue) maxDaysOverdue = days;
      if (days > 0) {
        avgDaysOverdueWeighted += days * balance;
        avgDaysOverdueBalance += balance;
      }
    } else if (status === "upcoming" || status === "dueToday") {
      upcomingAmount += balance;
    }
  }

  openTitleRows.sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      b.balanceReceivable - a.balanceReceivable
  );
  overdueTitleRows.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || b.balanceReceivable - a.balanceReceivable
  );

  const averageDaysOverdue =
    avgDaysOverdueBalance > 0
      ? roundMoney(avgDaysOverdueWeighted / avgDaysOverdueBalance)
      : overdueTitlesCount > 0
        ? 0
        : null;

  const agingBuckets: CustomerIntelligenceFinancialAgingBucket[] = AGING_BUCKET_DEFS.map((def) => {
    const bucket = agingAcc.get(def.key)!;
    return {
      key: def.key,
      label: def.label,
      amount: roundMoney(bucket.amount),
      count: bucket.count,
    };
  });

  const paymentHistory = customerRows
    .filter((row) => {
      if (!isFinanceArReceivedOrSettled(row)) return false;
      if (isNomusArStaleForReports(row, syncCutoff)) return false;
      return row.amountReceived > 0 || row.settlementDate != null;
    })
    .sort((a, b) => {
      const da = a.settlementDate ?? a.dueDate ?? a.syncedAt;
      const db = b.settlementDate ?? b.dueDate ?? b.syncedAt;
      return db.getTime() - da.getTime();
    })
    .slice(0, CUSTOMER_INTELLIGENCE_FINANCIAL_PAYMENT_HISTORY_LIMIT)
    .map((row) => ({
      externalId: row.externalId,
      description: row.description,
      dueDate: toIsoDateOnly(row.dueDate),
      settlementDate: row.settlementDate?.toISOString() ?? null,
      amountReceived: roundMoney(row.amountReceived),
    }));

  const dataQualityWarnings: string[] = [];
  if (exclusions.staleExcludedCount > 0) {
    dataQualityWarnings.push(
      `${exclusions.staleExcludedCount} título(s) stale excluído(s) (freshness MAX(syncedAt) − 1h).`
    );
  }
  if (exclusions.overdueWithoutFiscalExcludedCount > 0) {
    dataQualityWarnings.push(
      `${exclusions.overdueWithoutFiscalExcludedCount} título(s) vencido(s) sem NF excluído(s) da visão gerencial.`
    );
  }

  let financialStatus: CustomerIntelligenceFinancial["financialStatus"] = "no_titles";
  if (openTitlesCount > 0) {
    financialStatus = overdueTitlesCount > 0 ? "overdue" : "open";
  } else if (customerRows.some((r) => isFinanceArReceivedOrSettled(r))) {
    financialStatus = "healthy";
  }

  let riskAlert: string | null = null;
  if (overdueAmount > 0) {
    riskAlert = `Inadimplência: ${overdueAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${overdueTitlesCount} título(s) vencido(s).`;
  }

  return {
    receivableOpenAmount: roundMoney(receivableOpenAmount),
    overdueAmount: roundMoney(overdueAmount),
    upcomingAmount: roundMoney(upcomingAmount),
    openTitlesCount,
    overdueTitlesCount,
    maxDaysOverdue: overdueTitlesCount > 0 ? maxDaysOverdue : 0,
    averageDaysOverdue,
    nextDueDate: toIsoDateOnly(nextDueDate),
    agingBuckets,
    openTitles: openTitleRows.slice(0, CUSTOMER_INTELLIGENCE_FINANCIAL_OPEN_TITLES_LIMIT),
    overdueTitles: overdueTitleRows.slice(0, CUSTOMER_INTELLIGENCE_FINANCIAL_OPEN_TITLES_LIMIT),
    paymentHistory,
    dataQuality: {
      linkedByCnpj: true,
      linkMethod: "cnpj",
      warnings: dataQualityWarnings,
      staleExcludedCount: exclusions.staleExcludedCount,
      overdueWithoutFiscalExcludedCount: exclusions.overdueWithoutFiscalExcludedCount,
      syncCutoffAt: syncCutoff?.maxSyncedAt.toISOString() ?? null,
      fiscalBackingNote: FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE,
    },
    linkedByCnpj: true,
    financialStatus,
    riskAlert,
  };
}

export { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE };
