/**
 * Visões gerenciais de comissão por Contas a Receber.
 * Consome dados já calculados pelo motor oficial — sem recalcular percentuais.
 */
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { applyCommissionRecordScope } from "./commissionAccessScope.js";
import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import {
  getCommissionConfirmedDetail,
  listCommissionConfirmedPage,
  type CommissionConfirmedDetailPayload,
  type CommissionConfirmedPagePayload,
} from "./commissionConfirmed.server.js";
import {
  listCommissionReleasesPage,
  getCommissionReleaseDetail,
  type CommissionReleaseDetailPayload,
  type CommissionReleaseParcelRow,
  type CommissionReleasesPagePayload,
} from "./commissionReleases.server.js";
import {
  paginatedMeta,
  type CommissionConfirmedQuery,
  type CommissionReleasesQuery,
} from "./commissionQuery.js";

export type CommissionArParcelRow = CommissionReleaseParcelRow & {
  daysUntilDue: number | null;
  daysOverdue: number | null;
  commissionBlocked: number;
  paymentStatus: "LIBERADA" | "PARCIAL" | "PENDENTE_PAGAMENTO" | "PAGA" | "AGUARDANDO_BAIXA";
};

export type CommissionArViewPagePayload = {
  cards: {
    totalCommission: number;
    totalReleased: number;
    totalBlocked: number;
    rowCount: number;
  };
  rows: CommissionArParcelRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function resolveSettlementRange(query: CommissionReleasesQuery): {
  settlementFrom: Date | null;
  settlementTo: Date | null;
} {
  if (query.settlementFrom || query.settlementTo) {
    return { settlementFrom: query.settlementFrom, settlementTo: query.settlementTo };
  }
  if (query.year != null && query.month != null && query.month >= 1 && query.month <= 12) {
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
    return { settlementFrom: from, settlementTo: to };
  }
  if (query.year != null) {
    return {
      settlementFrom: new Date(Date.UTC(query.year, 0, 1)),
      settlementTo: new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999)),
    };
  }
  return { settlementFrom: null, settlementTo: null };
}

function enrichRow(row: CommissionReleaseParcelRow): CommissionArParcelRow {
  const today = startOfDay(new Date());
  const due = row.dueDate ? startOfDay(new Date(row.dueDate)) : null;
  let daysUntilDue: number | null = null;
  let daysOverdue: number | null = null;
  if (due) {
    const diffMs = due.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays >= 0) daysUntilDue = diffDays;
    else daysOverdue = Math.abs(diffDays);
  }
  const commissionBlocked = roundMoney(
    Math.max(0, row.commissionParcelAmount - row.commissionReleasedAmount)
  );

  let paymentStatus: CommissionArParcelRow["paymentStatus"] = "AGUARDANDO_BAIXA";
  if (row.receivedAmount <= 0) paymentStatus = "AGUARDANDO_BAIXA";
  else if (row.balanceToRelease <= 0 && row.commissionReleasedAmount > 0) {
    paymentStatus = "LIBERADA";
  } else if (row.commissionReleasedAmount > 0) {
    paymentStatus = "PARCIAL";
  }

  return {
    ...row,
    daysUntilDue,
    daysOverdue,
    commissionBlocked,
    paymentStatus,
  };
}

function buildArCards(rows: CommissionArParcelRow[]): CommissionArViewPagePayload["cards"] {
  let totalCommission = 0;
  let totalReleased = 0;
  let totalBlocked = 0;
  for (const row of rows) {
    totalCommission = roundMoney(totalCommission + row.commissionParcelAmount);
    totalReleased = roundMoney(totalReleased + row.commissionReleasedAmount);
    totalBlocked = roundMoney(totalBlocked + row.commissionBlocked);
  }
  return {
    totalCommission,
    totalReleased,
    totalBlocked,
    rowCount: rows.length,
  };
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): { slice: T[]; total: number } {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { slice: rows.slice(start, start + pageSize), total };
}

function filterPayableRows(rows: CommissionReleaseParcelRow[]): CommissionReleaseParcelRow[] {
  return rows.filter(
    (row) =>
      row.receivedAmount > 0 &&
      row.settlementDate != null &&
      row.commissionReleasedAmount > 0
  );
}

function filterFutureRows(rows: CommissionReleaseParcelRow[]): CommissionReleaseParcelRow[] {
  const today = startOfDay(new Date());
  return rows.filter((row) => {
    if (row.receivedAmount > 0) return false;
    if (row.receivableBalance <= 0 && row.commissionParcelAmount <= 0) return false;
    if (!row.dueDate) return row.commissionParcelAmount > 0;
    const due = startOfDay(new Date(row.dueDate));
    return due.getTime() >= today.getTime();
  });
}

function filterOverdueRows(rows: CommissionReleaseParcelRow[]): CommissionReleaseParcelRow[] {
  const today = startOfDay(new Date());
  return rows.filter((row) => {
    if (row.highlight === "overdue") return true;
    if (row.receivedAmount > 0) return false;
    if (!row.dueDate) return false;
    const due = startOfDay(new Date(row.dueDate));
    const blocked = roundMoney(Math.max(0, row.commissionParcelAmount - row.commissionReleasedAmount));
    return due.getTime() < today.getTime() && blocked > 0;
  });
}

async function listArViewPage(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope,
  mode: "payable" | "future" | "overdue"
): Promise<CommissionArViewPagePayload> {
  const settlementRange =
    mode === "payable" ? resolveSettlementRange(query) : { settlementFrom: null, settlementTo: null };

  const base = await listCommissionReleasesPage(
    {
      ...query,
      ...settlementRange,
      page: 1,
      pageSize: 10000,
    },
    scope
  );

  let filtered = base.rows;
  if (mode === "payable") filtered = filterPayableRows(base.rows);
  if (mode === "future") filtered = filterFutureRows(base.rows);
  if (mode === "overdue") {
    filtered = filterOverdueRows(base.rows.map(enrichRow));
  }

  const enriched = filtered.map(enrichRow);
  const { slice, total } = paginateRows(enriched, query.page, query.pageSize);

  return {
    cards: buildArCards(enriched),
    rows: slice,
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function listCommissionPayablePage(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<CommissionArViewPagePayload> {
  return listArViewPage(query, scope, "payable");
}

export async function listCommissionFuturePage(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<CommissionArViewPagePayload> {
  return listArViewPage(query, scope, "future");
}

export async function listCommissionOverduePage(
  query: CommissionReleasesQuery,
  scope: CommissionAccessScope
): Promise<CommissionArViewPagePayload> {
  return listArViewPage(query, scope, "overdue");
}

export async function listCommissionGeneratedPage(
  query: CommissionConfirmedQuery,
  scope: CommissionAccessScope
): Promise<CommissionConfirmedPagePayload> {
  return listCommissionConfirmedPage(query, scope);
}

export async function getCommissionGeneratedDetail(
  confirmKey: string,
  scope: CommissionAccessScope
): Promise<CommissionConfirmedDetailPayload | null> {
  return getCommissionConfirmedDetail(confirmKey, scope);
}

export async function getCommissionAuditTrailDetail(input: {
  scheduleId?: string | null;
  confirmKey?: string | null;
  scope: CommissionAccessScope;
}): Promise<{
  kind: "schedule" | "document";
  schedule: CommissionReleaseDetailPayload | null;
  document: CommissionConfirmedDetailPayload | null;
  explanation: string | null;
}> {
  if (input.scheduleId) {
    const emptyQuery: CommissionReleasesQuery = {
      year: null,
      month: null,
      from: null,
      to: null,
      commissionPersonId: null,
      customer: null,
      orderCode: null,
      nfeNumber: null,
      sellerId: null,
      representativeId: null,
      receivableId: null,
      dueFrom: null,
      dueTo: null,
      settlementFrom: null,
      settlementTo: null,
      accountStatus: null,
      releaseFilter: null,
      page: 1,
      pageSize: 1,
    };
    const schedule = await getCommissionReleaseDetail(
      input.scheduleId,
      emptyQuery,
      input.scope
    );
    if (!schedule) {
      return { kind: "schedule", schedule: null, document: null, explanation: null };
    }
    const settlement = schedule.settlementDate
      ? new Date(schedule.settlementDate).toLocaleDateString("pt-BR")
      : null;
    const explanation = settlement
      ? `Comissão da parcela ${schedule.installmentNumber ?? "—"} liberada proporcionalmente ao recebimento do título. Baixa em ${settlement}.`
      : "Comissão rateada nesta parcela; aguardando baixa do título no Contas a Receber.";
    return { kind: "schedule", schedule, document: null, explanation };
  }

  if (input.confirmKey) {
    const document = await getCommissionConfirmedDetail(input.confirmKey, input.scope);
    if (!document) {
      return { kind: "document", schedule: null, document: null, explanation: null };
    }
    const explanation = `Comissão gerada pela NF ${document.nfeNumber ?? "—"}. Total da NF: R$ ${document.totalConfirmedCommission.toFixed(2)}. Rateada entre ${document.receivables.length} título(s) conforme valor financeiro vinculado.`;
    return { kind: "document", schedule: null, document, explanation };
  }

  return { kind: "document", schedule: null, document: null, explanation: null };
}

export type CommissionDashboardYtdPayload = {
  year: number;
  generatedYtd: number;
  releasedYtd: number;
  payableInMonth: number;
  futureCommission: number;
  overdueCommission: number;
  averageRatePercent: number;
  commissionableBaseYtd: number;
  noCommissionSales: { amount: number; customerCount: number; documentCount: number };
  tierDistribution: Array<{ tierCode: string; tierName: string; baseAmount: number; commissionAmount: number; count: number }>;
  monthlyYtd: Array<{ month: number; generated: number; released: number; pending: number }>;
  sellerRanking: Array<{
    commissionPersonId: string;
    personName: string;
    generated: number;
    released: number;
    future: number;
    overdue: number;
  }>;
};

function metaTier(metadataJson: unknown): { code: string; name: string } {
  if (!metadataJson || typeof metadataJson !== "object") {
    return { code: "—", name: "—" };
  }
  const m = metadataJson as Record<string, unknown>;
  return {
    code: typeof m.tierCode === "string" ? m.tierCode : "—",
    name: typeof m.tierName === "string" ? m.tierName : String(m.tierCode ?? "—"),
  };
}

export async function buildCommissionDashboardYtd(
  year: number,
  scope: CommissionAccessScope,
  commissionPersonId: string | null,
  month: number | null
): Promise<CommissionDashboardYtdPayload> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const recordScope = applyCommissionRecordScope(scope, { commissionPersonId });
  const recordWhere: import("@prisma/client").Prisma.CommissionRecordWhereInput = {
    AND: [
      recordScope,
      {
        confirmedAt: { gte: yearStart, lte: yearEnd },
        status: {
          in: [
            "CONFIRMED_BY_OUTPUT_DOCUMENT",
            "WAITING_RECEIVABLE",
            "WAITING_PAYMENT",
            "PARTIALLY_RELEASED",
            "RELEASED",
            "PAID_PARTIAL",
            "PAID_TOTAL",
          ],
        },
      },
    ],
  };
  if (commissionPersonId) {
    (recordWhere.AND as import("@prisma/client").Prisma.CommissionRecordWhereInput[]).push({
      commissionPersonId,
    });
  }

  const records = await prisma.commissionRecord.findMany({
    where: recordWhere,
    select: {
      id: true,
      commissionPersonId: true,
      commissionPerson: { select: { name: true } },
      baseAmount: true,
      commissionAmount: true,
      releasedAmount: true,
      confirmedAt: true,
      metadataJson: true,
      customerExternalId: true,
    },
  });

  let generatedYtd = 0;
  let commissionableBaseYtd = 0;
  const tierMap = new Map<string, { tierName: string; baseAmount: number; commissionAmount: number; count: number }>();
  const monthlyMap = new Map<number, { generated: number; released: number; pending: number }>();

  for (const r of records) {
    const commission = decimalToNumber(r.commissionAmount);
    const base = decimalToNumber(r.baseAmount);
    generatedYtd = roundMoney(generatedYtd + commission);
    commissionableBaseYtd = roundMoney(commissionableBaseYtd + base);
    const tier = metaTier(r.metadataJson);
    const te = tierMap.get(tier.code) ?? { tierName: tier.name, baseAmount: 0, commissionAmount: 0, count: 0 };
    te.baseAmount = roundMoney(te.baseAmount + base);
    te.commissionAmount = roundMoney(te.commissionAmount + commission);
    te.count += 1;
    tierMap.set(tier.code, te);
    if (r.confirmedAt) {
      const m = r.confirmedAt.getUTCMonth() + 1;
      const entry = monthlyMap.get(m) ?? { generated: 0, released: 0, pending: 0 };
      entry.generated = roundMoney(entry.generated + commission);
      monthlyMap.set(m, entry);
    }
  }

  const releasesQuery: CommissionReleasesQuery = {
    year,
    month,
    from: null,
    to: null,
    commissionPersonId,
    customer: null,
    orderCode: null,
    nfeNumber: null,
    sellerId: null,
    representativeId: null,
    receivableId: null,
    dueFrom: null,
    dueTo: null,
    settlementFrom: yearStart,
    settlementTo: yearEnd,
    accountStatus: null,
    releaseFilter: null,
    page: 1,
    pageSize: 10000,
  };

  const [payableAll, futureAll, overdueAll, exceptionsCount] = await Promise.all([
    listCommissionPayablePage(releasesQuery, scope),
    listCommissionFuturePage({ ...releasesQuery, settlementFrom: null, settlementTo: null }, scope),
    listCommissionOverduePage({ ...releasesQuery, settlementFrom: null, settlementTo: null }, scope),
    prisma.commissionCustomerException.count({ where: { active: true } }),
  ]);

  let releasedYtd = payableAll.cards.totalReleased;
  let payableInMonth = payableAll.cards.totalReleased;
  if (month != null && month >= 1 && month <= 12) {
    const monthPayable = await listCommissionPayablePage(
      { ...releasesQuery, settlementFrom: new Date(Date.UTC(year, month - 1, 1)), settlementTo: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)) },
      scope
    );
    payableInMonth = monthPayable.cards.totalReleased;
  }

  const futureCommission = futureAll.cards.totalCommission;
  const overdueCommission = overdueAll.cards.totalBlocked;

  const averageRatePercent =
    commissionableBaseYtd > 0
      ? roundMoney((generatedYtd / commissionableBaseYtd) * 100)
      : 0;

  const sellerMap = new Map<
    string,
    { personName: string; generated: number; released: number; future: number; overdue: number }
  >();
  for (const r of records) {
    const entry = sellerMap.get(r.commissionPersonId) ?? {
      personName: r.commissionPerson.name,
      generated: 0,
      released: 0,
      future: 0,
      overdue: 0,
    };
    entry.generated = roundMoney(entry.generated + decimalToNumber(r.commissionAmount));
    sellerMap.set(r.commissionPersonId, entry);
  }
  for (const row of payableAll.rows) {
    const entry = sellerMap.get(row.commissionPersonId);
    if (entry) entry.released = roundMoney(entry.released + row.commissionReleasedAmount);
  }
  for (const row of futureAll.rows) {
    const entry = sellerMap.get(row.commissionPersonId);
    if (entry) entry.future = roundMoney(entry.future + row.commissionParcelAmount);
  }
  for (const row of overdueAll.rows) {
    const entry = sellerMap.get(row.commissionPersonId);
    if (entry) entry.overdue = roundMoney(entry.overdue + row.commissionBlocked);
  }

  return {
    year,
    generatedYtd,
    releasedYtd,
    payableInMonth,
    futureCommission,
    overdueCommission,
    averageRatePercent,
    commissionableBaseYtd,
    noCommissionSales: {
      amount: 0,
      customerCount: exceptionsCount,
      documentCount: 0,
    },
    tierDistribution: [...tierMap.entries()].map(([tierCode, v]) => ({
      tierCode,
      tierName: v.tierName,
      baseAmount: v.baseAmount,
      commissionAmount: v.commissionAmount,
      count: v.count,
    })),
    monthlyYtd: [...monthlyMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([monthNum, v]) => ({ month: monthNum, ...v })),
    sellerRanking: [...sellerMap.entries()]
      .map(([commissionPersonId, v]) => ({ commissionPersonId, ...v }))
      .sort((a, b) => b.generated - a.generated)
      .slice(0, 20),
  };
}
