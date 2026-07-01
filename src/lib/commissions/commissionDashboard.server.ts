import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  buildCommissionDashboardWhere,
  COMMISSION_CONFIRMED_STATUSES,
  COMMISSION_FORECAST_STATUSES,
  type CommissionDashboardQuery,
} from "./commissionQuery.js";

export type CommissionDashboardCards = {
  forecastAmount: number;
  confirmedAmount: number;
  waitingNfeAmount: number;
  waitingReceivableAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceToPayAmount: number;
  criticalDivergencesCount: number;
};

export type CommissionDashboardPayload = {
  cards: CommissionDashboardCards;
  monthlySeries: Array<{
    year: number;
    month: number;
    forecastAmount: number;
    confirmedAmount: number;
    releasedAmount: number;
    paidAmount: number;
  }>;
  byPerson: Array<{
    commissionPersonId: string;
    personName: string;
    commissionAmount: number;
    releasedAmount: number;
    paidAmount: number;
  }>;
  byStatus: Array<{ status: string; count: number; commissionAmount: number }>;
  topCustomers: Array<{
    customerExternalId: number | null;
    customerName: string | null;
    commissionAmount: number;
  }>;
  auditSummary: { total: number; critical: number; warning: number; unresolved: number };
};

export function emptyCommissionDashboard(): CommissionDashboardPayload {
  return {
    cards: {
      forecastAmount: 0,
      confirmedAmount: 0,
      waitingNfeAmount: 0,
      waitingReceivableAmount: 0,
      releasedAmount: 0,
      paidAmount: 0,
      balanceToPayAmount: 0,
      criticalDivergencesCount: 0,
    },
    monthlySeries: [],
    byPerson: [],
    byStatus: [],
    topCustomers: [],
    auditSummary: { total: 0, critical: 0, warning: 0, unresolved: 0 },
  };
}

function aggregateMonthlySeries(
  rows: Array<{
    calculatedAt: Date;
    status: string;
    commissionAmount: unknown;
    releasedAmount: unknown;
    paidAmount: unknown;
  }>
): CommissionDashboardPayload["monthlySeries"] {
  const map = new Map<
    string,
    {
      year: number;
      month: number;
      forecastAmount: number;
      confirmedAmount: number;
      releasedAmount: number;
      paidAmount: number;
    }
  >();

  for (const row of rows) {
    const year = row.calculatedAt.getUTCFullYear();
    const month = row.calculatedAt.getUTCMonth() + 1;
    const key = `${year}-${month}`;
    const entry = map.get(key) ?? {
      year,
      month,
      forecastAmount: 0,
      confirmedAmount: 0,
      releasedAmount: 0,
      paidAmount: 0,
    };
    const commission = decimalToNumber(row.commissionAmount);
    const released = decimalToNumber(row.releasedAmount);
    const paid = decimalToNumber(row.paidAmount);
    if (COMMISSION_FORECAST_STATUSES.includes(row.status as (typeof COMMISSION_FORECAST_STATUSES)[number])) {
      entry.forecastAmount = roundMoney(entry.forecastAmount + commission);
    }
    if (COMMISSION_CONFIRMED_STATUSES.includes(row.status as (typeof COMMISSION_CONFIRMED_STATUSES)[number])) {
      entry.confirmedAmount = roundMoney(entry.confirmedAmount + commission);
    }
    entry.releasedAmount = roundMoney(entry.releasedAmount + released);
    entry.paidAmount = roundMoney(entry.paidAmount + paid);
    map.set(key, entry);
  }

  return [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

export async function buildCommissionDashboard(
  query: CommissionDashboardQuery,
  scope: CommissionAccessScope
): Promise<CommissionDashboardPayload> {
  const where = buildCommissionDashboardWhere(query, scope);

  const [statusGroups, personGroups, customerGroups, auditCounts, monthlySourceRows, criticalDivergencesCount] =
    await Promise.all([
      prisma.commissionRecord.groupBy({
        by: ["status"],
        where,
        _sum: { commissionAmount: true, releasedAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      prisma.commissionRecord.groupBy({
        by: ["commissionPersonId"],
        where,
        _sum: { commissionAmount: true, releasedAmount: true, paidAmount: true },
        orderBy: { _sum: { commissionAmount: "desc" } },
        take: 20,
      }),
      prisma.commissionRecord.groupBy({
        by: ["customerExternalId", "customerName"],
        where,
        _sum: { commissionAmount: true },
        orderBy: { _sum: { commissionAmount: "desc" } },
        take: 10,
      }),
      prisma.commissionAuditIssue.groupBy({
        by: ["severity", "resolved"],
        _count: { _all: true },
      }),
      prisma.commissionRecord.findMany({
        where,
        select: {
          calculatedAt: true,
          status: true,
          commissionAmount: true,
          releasedAmount: true,
          paidAmount: true,
        },
      }),
      prisma.commissionAuditIssue.count({
        where: { severity: "CRITICAL", resolved: false },
      }),
    ]);

  let forecastAmount = 0;
  let confirmedAmount = 0;
  let waitingNfeAmount = 0;
  let waitingReceivableAmount = 0;
  let releasedAmount = 0;
  let paidAmount = 0;

  for (const g of statusGroups) {
    const commission = decimalToNumber(g._sum.commissionAmount);
    const released = decimalToNumber(g._sum.releasedAmount);
    const paid = decimalToNumber(g._sum.paidAmount);
    const status = g.status;

    if (COMMISSION_FORECAST_STATUSES.includes(status as (typeof COMMISSION_FORECAST_STATUSES)[number])) {
      forecastAmount = roundMoney(forecastAmount + commission);
    }
    if (COMMISSION_CONFIRMED_STATUSES.includes(status as (typeof COMMISSION_CONFIRMED_STATUSES)[number])) {
      confirmedAmount = roundMoney(confirmedAmount + commission);
    }
    if (status === "WAITING_NFE") waitingNfeAmount = roundMoney(waitingNfeAmount + commission);
    if (status === "WAITING_RECEIVABLE") {
      waitingReceivableAmount = roundMoney(waitingReceivableAmount + commission);
    }
    if (
      status === "PARTIALLY_RELEASED" ||
      status === "RELEASED" ||
      status === "PAID_PARTIAL" ||
      status === "PAID_TOTAL"
    ) {
      releasedAmount = roundMoney(releasedAmount + released);
    }
    paidAmount = roundMoney(paidAmount + paid);
  }

  const balanceToPayAmount = roundMoney(Math.max(0, releasedAmount - paidAmount));

  let auditTotal = 0;
  let auditCritical = 0;
  let auditWarning = 0;
  let auditUnresolved = 0;
  for (const row of auditCounts) {
    auditTotal += row._count._all;
    if (!row.resolved) auditUnresolved += row._count._all;
    if (row.severity === "CRITICAL") auditCritical += row._count._all;
    if (row.severity === "WARNING") auditWarning += row._count._all;
  }

  const personIds = personGroups.map((g) => g.commissionPersonId);
  const persons =
    personIds.length > 0
      ? await prisma.commissionPerson.findMany({
          where: { id: { in: personIds } },
          select: { id: true, name: true },
        })
      : [];
  const personNameById = new Map(persons.map((p) => [p.id, p.name]));

  return {
    cards: {
      forecastAmount,
      confirmedAmount,
      waitingNfeAmount,
      waitingReceivableAmount,
      releasedAmount,
      paidAmount,
      balanceToPayAmount,
      criticalDivergencesCount,
    },
    monthlySeries: aggregateMonthlySeries(monthlySourceRows),
    byPerson: personGroups.map((g) => ({
      commissionPersonId: g.commissionPersonId,
      personName: personNameById.get(g.commissionPersonId) ?? "—",
      commissionAmount: decimalToNumber(g._sum.commissionAmount),
      releasedAmount: decimalToNumber(g._sum.releasedAmount),
      paidAmount: decimalToNumber(g._sum.paidAmount),
    })),
    byStatus: statusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
      commissionAmount: decimalToNumber(g._sum.commissionAmount),
    })),
    topCustomers: customerGroups.map((g) => ({
      customerExternalId: g.customerExternalId,
      customerName: g.customerName,
      commissionAmount: decimalToNumber(g._sum.commissionAmount),
    })),
    auditSummary: {
      total: auditTotal,
      critical: auditCritical,
      warning: auditWarning,
      unresolved: auditUnresolved,
    },
  };
}
