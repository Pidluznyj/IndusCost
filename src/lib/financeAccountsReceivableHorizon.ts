import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  isFinanceArAllowedInManagementReport,
  isFinanceArOpen,
  mapPrismaRowToFinanceArDashboardRow,
  classifyFinanceArTitle,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { FINANCE_AR_TITLE_SELECT } from "./financeAccountsReceivableTitles.js";
import {
  computeDaysFromToday,
  FINANCE_HORIZON_BUCKETS,
  FINANCE_HORIZON_MAX_DAY,
  roundHorizonMoney,
  startOfLocalDay,
} from "./financeHorizonBuckets.js";
import {
  isFinanceArExcludedFromReports,
  mergeFinanceArPrismaWhereWithSyncCutoff,
  resolveEffectiveNomusArReportSyncCutoff,
  resolveNomusArReportSyncCutoffFromPrisma,
  type NomusArReportSyncCutoff,
} from "./financeNomusArReportFreshness.js";

export const FINANCE_AR_OPEN_HORIZON_TITLE = "Horizonte financeiro — carteira aberta";
export const FINANCE_AR_OPEN_HORIZON_SUBTITLE = "Próximos 60 dias a partir de hoje";
export const FINANCE_AR_OPEN_HORIZON_SCOPE_NOTE =
  "Visão operacional independente dos filtros de mês/ano. Considera todos os títulos com saldo em aberto e vencimento nos próximos 60 dias.";
export const FINANCE_AR_OPEN_HORIZON_OVERDUE_NOTE =
  "Títulos vencidos aparecem separados para não distorcer o total dos próximos 60 dias.";

/** Filtros neutros para drilldown do horizonte — mesma carteira global dos cards (ignora mês/ano da página). */
export const FINANCE_AR_OPEN_HORIZON_DRILLDOWN_SCOPE_NOTE =
  "Drilldown usa a carteira aberta global dos cards, independente dos filtros de mês/ano da página.";

export type AccountsReceivableOpenHorizonBucketKey =
  | "overdue"
  | "0_7"
  | "8_15"
  | "16_30"
  | "31_45"
  | "46_60"
  | "total_60";

export type AccountsReceivableOpenHorizonTitle = {
  id: string;
  externalId: number;
  customerName: string | null;
  companyName: string | null;
  dueDate: string | null;
  titleNumber: string | null;
  invoiceNumber: string | null;
  amountOpen: number;
  daysUntilDue: number;
  bucketKey: AccountsReceivableOpenHorizonBucketKey;
  status: string;
};

export type AccountsReceivableOpenHorizonBucket = {
  key: AccountsReceivableOpenHorizonBucketKey;
  label: string;
  fromDays: number | null;
  toDays: number | null;
  amount: number;
  titlesCount: number;
  shareOfTotal60?: number;
  tooltip: string;
};

export type AccountsReceivableOpenHorizon = {
  generatedAt: string;
  today: string;
  scope: "open_receivables_global";
  ignoresPagePeriodFilters: true;
  usesOpenBalance: true;
  title: string;
  subtitle: string;
  scopeNote: string;
  overdueNote: string;
  buckets: AccountsReceivableOpenHorizonBucket[];
  overdue: AccountsReceivableOpenHorizonBucket;
  total60: AccountsReceivableOpenHorizonBucket;
  totals: {
    overdueAmount: number;
    overdueTitlesCount: number;
    total60Amount: number;
    total60TitlesCount: number;
    totalOpenAmount: number;
    totalOpenTitlesCount: number;
  };
  topCustomers: Array<{
    customerName: string;
    amount: number;
    titlesCount: number;
  }>;
  titlesByBucket: Record<AccountsReceivableOpenHorizonBucketKey, AccountsReceivableOpenHorizonTitle[]>;
  insights: string[];
  audit: {
    source: "accounts_receivable";
    periodFiltersIgnored: string[];
    excludedBecauseSettled: number;
    warnings: string[];
  };
};

const PERIOD_FILTERS_IGNORED = ["year", "month", "dueDateFrom", "dueDateTo", "status", "companyName", "personName", "personCnpj", "paymentMethodName", "bankAccountName", "invoiceIssued"] as const;

const BUCKET_TOOLTIPS: Record<Exclude<AccountsReceivableOpenHorizonBucketKey, "total_60">, string> = {
  overdue: "Títulos com saldo em aberto e vencimento anterior a hoje.",
  "0_7": "Saldo em aberto com vencimento entre hoje e os próximos 7 dias.",
  "8_15": "Saldo em aberto com vencimento entre 8 e 15 dias a partir de hoje.",
  "16_30": "Saldo em aberto com vencimento entre 16 e 30 dias a partir de hoje.",
  "31_45": "Saldo em aberto com vencimento entre 31 e 45 dias a partir de hoje.",
  "46_60": "Saldo em aberto com vencimento entre 46 e 60 dias a partir de hoje.",
};

export function buildFinanceArPrismaWhereForOpenHorizon(
  syncCutoff?: NomusArReportSyncCutoff | null
): Prisma.NomusAccountsReceivableWhereInput {
  return mergeFinanceArPrismaWhereWithSyncCutoff({ balanceReceivable: { gt: 0 } }, syncCutoff);
}

export async function loadFinanceArOpenHorizonRowsFromPrisma(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  referenceDate: Date = new Date()
): Promise<{ rows: FinanceArDashboardRow[]; syncCutoff: NomusArReportSyncCutoff | null }> {
  const syncCutoff = await resolveNomusArReportSyncCutoffFromPrisma(db);
  const where = buildFinanceArPrismaWhereForOpenHorizon(syncCutoff);
  const rows = await db.nomusAccountsReceivable.findMany({
    where,
    select: FINANCE_AR_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return {
    rows: rows.map(mapPrismaRowToFinanceArDashboardRow),
    syncCutoff,
  };
}

function assignOpenHorizonBucketKey(
  daysFromToday: number
): Exclude<AccountsReceivableOpenHorizonBucketKey, "total_60"> | null {
  if (!Number.isFinite(daysFromToday)) return null;
  if (daysFromToday < 0) return "overdue";
  if (daysFromToday > FINANCE_HORIZON_MAX_DAY) return null;
  for (const def of FINANCE_HORIZON_BUCKETS) {
    if (daysFromToday >= def.fromDay && daysFromToday <= def.toDay) {
      return def.key;
    }
  }
  return null;
}

function formatInsightCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function buildAccountsReceivableOpenHorizon(
  sourceRows: FinanceArDashboardRow[],
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): AccountsReceivableOpenHorizon {
  const today = startOfLocalDay(referenceDate);
  const effectiveCutoff = resolveEffectiveNomusArReportSyncCutoff(sourceRows, syncCutoff);
  let excludedBecauseSettled = 0;

  const acc = new Map<
    Exclude<AccountsReceivableOpenHorizonBucketKey, "total_60">,
    { amount: number; count: number; titles: AccountsReceivableOpenHorizonTitle[] }
  >();
  acc.set("overdue", { amount: 0, count: 0, titles: [] });
  for (const def of FINANCE_HORIZON_BUCKETS) {
    acc.set(def.key, { amount: 0, count: 0, titles: [] });
  }

  const customerAcc = new Map<string, { amount: number; count: number }>();
  let totalOpenAmount = 0;
  let totalOpenTitlesCount = 0;

  for (const row of sourceRows) {
    if (isFinanceArExcludedFromReports(row, effectiveCutoff)) continue;
    if (!isFinanceArAllowedInManagementReport(row, referenceDate)) continue;
    if (row.suspendCollection === true) continue;
    if (!isFinanceArOpen(row)) {
      excludedBecauseSettled += 1;
      continue;
    }
    if (!row.dueDate) continue;

    const balance = row.balanceReceivable;
    if (!Number.isFinite(balance) || balance <= 0) {
      excludedBecauseSettled += 1;
      continue;
    }

    totalOpenAmount += balance;
    totalOpenTitlesCount += 1;

    const days = computeDaysFromToday(row.dueDate, today);
    const bucketKey = assignOpenHorizonBucketKey(days);
    if (!bucketKey) continue;

    const bucket = acc.get(bucketKey)!;
    bucket.amount += balance;
    bucket.count += 1;

    const title: AccountsReceivableOpenHorizonTitle = {
      id: String(row.externalId),
      externalId: row.externalId,
      customerName: row.personName,
      companyName: row.companyName,
      dueDate: row.dueDate.toISOString(),
      titleNumber: row.description?.trim() || null,
      invoiceNumber: row.sourceInvoiceNumber,
      amountOpen: roundHorizonMoney(balance),
      daysUntilDue: days,
      bucketKey,
      status: classifyFinanceArTitle(row, today),
    };
    bucket.titles.push(title);

    if (bucketKey !== "overdue") {
      const customerName = row.personName?.trim() || "Sem cliente";
      const existing = customerAcc.get(customerName) ?? { amount: 0, count: 0 };
      existing.amount += balance;
      existing.count += 1;
      customerAcc.set(customerName, existing);
    }
  }

  const futureBucketKeys = FINANCE_HORIZON_BUCKETS.map((b) => b.key);
  const futureBucketsData = futureBucketKeys.map((key) => acc.get(key)!);
  const total60Amount = roundHorizonMoney(futureBucketsData.reduce((sum, b) => sum + b.amount, 0));
  const total60TitlesCount = futureBucketsData.reduce((sum, b) => sum + b.count, 0);

  const buildBucket = (
    key: Exclude<AccountsReceivableOpenHorizonBucketKey, "total_60">,
    label: string,
    fromDays: number | null,
    toDays: number | null
  ): AccountsReceivableOpenHorizonBucket => {
    const data = acc.get(key)!;
    const amount = roundHorizonMoney(data.amount);
    return {
      key,
      label,
      fromDays,
      toDays,
      amount,
      titlesCount: data.count,
      shareOfTotal60:
        key !== "overdue" && total60Amount > 0
          ? roundHorizonMoney((amount / total60Amount) * 100)
          : undefined,
      tooltip: BUCKET_TOOLTIPS[key],
    };
  };

  const overdue = buildBucket("overdue", "Vencidos", null, -1);
  const buckets = FINANCE_HORIZON_BUCKETS.map((def) =>
    buildBucket(def.key, def.label, def.fromDay, def.toDay)
  );
  const total60: AccountsReceivableOpenHorizonBucket = {
    key: "total_60",
    label: "Total 60 dias",
    fromDays: 0,
    toDays: FINANCE_HORIZON_MAX_DAY,
    amount: total60Amount,
    titlesCount: total60TitlesCount,
    tooltip: "Soma das faixas de 0 a 60 dias. Não inclui vencidos.",
  };

  const topCustomers = [...customerAcc.entries()]
    .map(([customerName, data]) => ({
      customerName,
      amount: roundHorizonMoney(data.amount),
      titlesCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const insights: string[] = [];
  const largestFuture = [...buckets].sort((a, b) => b.amount - a.amount).find((b) => b.amount > 0);
  if (largestFuture) {
    insights.push(
      `Maior concentração: ${largestFuture.label} com ${formatInsightCurrency(largestFuture.amount)}.`
    );
  }
  if (topCustomers[0]) {
    insights.push(
      `Top cliente no horizonte: ${topCustomers[0].customerName} — ${formatInsightCurrency(topCustomers[0].amount)}.`
    );
  }
  if (overdue.amount > 0) {
    insights.push(`Títulos vencidos: ${formatInsightCurrency(overdue.amount)}.`);
  }

  const titlesByBucket = {
    overdue: acc.get("overdue")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    "0_7": acc.get("0_7")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    "8_15": acc.get("8_15")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    "16_30": acc.get("16_30")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    "31_45": acc.get("31_45")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    "46_60": acc.get("46_60")!.titles.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    total_60: futureBucketKeys.flatMap((key) => acc.get(key)!.titles),
  } satisfies Record<AccountsReceivableOpenHorizonBucketKey, AccountsReceivableOpenHorizonTitle[]>;

  return {
    generatedAt: referenceDate.toISOString(),
    today: today.toISOString(),
    scope: "open_receivables_global",
    ignoresPagePeriodFilters: true,
    usesOpenBalance: true,
    title: FINANCE_AR_OPEN_HORIZON_TITLE,
    subtitle: FINANCE_AR_OPEN_HORIZON_SUBTITLE,
    scopeNote: FINANCE_AR_OPEN_HORIZON_SCOPE_NOTE,
    overdueNote: FINANCE_AR_OPEN_HORIZON_OVERDUE_NOTE,
    buckets,
    overdue,
    total60,
    totals: {
      overdueAmount: overdue.amount,
      overdueTitlesCount: overdue.titlesCount,
      total60Amount,
      total60TitlesCount,
      totalOpenAmount: roundHorizonMoney(totalOpenAmount),
      totalOpenTitlesCount,
    },
    topCustomers,
    titlesByBucket,
    insights,
    audit: {
      source: "accounts_receivable",
      periodFiltersIgnored: [...PERIOD_FILTERS_IGNORED],
      excludedBecauseSettled,
      warnings: [],
    },
  };
}

export function accountsReceivableOpenHorizonIsFinite(horizon: AccountsReceivableOpenHorizon): boolean {
  const values = [
    ...horizon.buckets.flatMap((b) => [b.amount, b.titlesCount, b.shareOfTotal60 ?? 0]),
    horizon.overdue.amount,
    horizon.total60.amount,
    ...Object.values(horizon.totals),
  ];
  return values.every((v) => Number.isFinite(v));
}
